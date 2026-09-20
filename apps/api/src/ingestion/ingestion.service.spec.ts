import { HttpStatus } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { DeviceStatus, type Prisma } from '@prisma/client';
import type { AuthenticatedDevice } from '../auth/device-auth.guard';
import { ApiException } from '../common/errors/api.exception';
import { ErrorCode } from '../common/errors/error-codes';
import type { PrismaService } from '../prisma/prisma.service';
import { IngestionService } from './ingestion.service';
import type { ReferenceDataService } from './reference-data.service';
import type { SensorTypeSpec } from './domain/evaluate-reading';
import { describeFlags } from './domain/quality-flags';

/**
 * Deliverable 4.5 nomor 3: dedup / idempotensi.
 *
 * Berbeda dengan tiga berkas uji lainnya yang menguji fungsi murni, dedup
 * adalah perilaku SERVICE. Karena itu di sini Prisma diganti tiruan: yang
 * diuji bukan apakah PostgreSQL bisa menegakkan primary key — itu sudah pasti
 * — melainkan apakah service benar-benar menyerahkan dedup kepada constraint,
 * menghitung selisihnya dengan benar, dan menyusun kunci yang tepat.
 *
 * Tiruannya sengaja ditulis tangan, bukan memakai pustaka mocking, supaya
 * terlihat jelas apa saja yang benar-benar disentuh service ini.
 */

// ---------------------------------------------------------------------------
// Data dan tiruan
// ---------------------------------------------------------------------------

const SENSOR_TYPES: Record<string, SensorTypeSpec> = {
  temp_air: {
    id: 1,
    key: 'temp_air',
    minValid: -20,
    maxValid: 60,
    isCumulative: false,
    unitPerCount: null,
    isCircular: false,
  },
  humidity: {
    id: 2,
    key: 'humidity',
    minValid: 0,
    maxValid: 100,
    isCumulative: false,
    unitPerCount: null,
    isCircular: false,
  },
  rain_counter: {
    id: 6,
    key: 'rain_counter',
    minValid: 0,
    maxValid: 1_000_000,
    isCumulative: true,
    unitPerCount: 0.2,
    isCircular: false,
  },
};

const DEVICE: AuthenticatedDevice = {
  id: '11111111-1111-1111-1111-111111111111',
  deviceCode: 'WS-GRT-001',
  status: DeviceStatus.ACTIVE,
  credentialId: 'cred-1',
};

interface CreateManyCall {
  data: Prisma.SensorReadingCreateManyInput[];
  skipDuplicates?: boolean;
}

/**
 * Prisma tiruan yang mencatat apa yang ditulis dan bisa diatur berapa baris
 * yang "benar-benar masuk" — inilah cara meniru ON CONFLICT DO NOTHING.
 */
function createPrismaStub(options: { insertedCount?: number | 'all'; throwOnInsert?: unknown } = {}) {
  const calls: CreateManyCall[] = [];
  const dirtyBuckets: unknown[] = [];

  const prisma = {
    sensorReading: {
      createMany: jest.fn(async (args: CreateManyCall) => {
        if (options.throwOnInsert) {
          throw options.throwOnInsert;
        }
        calls.push(args);
        const inserted =
          options.insertedCount === undefined || options.insertedCount === 'all'
            ? args.data.length
            : options.insertedCount;
        return { count: inserted };
      }),
    },
    aggregateDirtyBucket: {
      createMany: jest.fn(async (args: { data: unknown[] }) => {
        dirtyBuckets.push(...args.data);
        return { count: args.data.length };
      }),
    },
    device: {
      updateMany: jest.fn(async () => ({ count: 1 })),
      update: jest.fn(async () => ({})),
    },
    deviceHeartbeat: {
      createMany: jest.fn(async () => ({ count: 1 })),
    },
    deviceStatusHistory: {
      create: jest.fn(async () => ({})),
    },
    $transaction: jest.fn(async (ops: unknown[]) => Promise.all(ops)),
  };

  return { prisma: prisma as unknown as PrismaService, calls, dirtyBuckets, raw: prisma };
}

function createReferenceStub(previousCumulative: Map<string, number> = new Map()) {
  return {
    getSensorTypesByKey: jest.fn(async () => new Map(Object.entries(SENSOR_TYPES))),
    // Tanpa instalasi: pembacaan tetap tersimpan, hanya ditandai
    // NO_INSTALLATION. Dedup tidak bergantung pada resolusi sensor.
    loadInstallations: jest.fn(async () => new Map()),
    loadCalibrations: jest.fn(async () => new Map()),
    loadPreviousCumulativeValues: jest.fn(async () => previousCumulative),
  } as unknown as ReferenceDataService;
}

function createConfigStub(overrides: Record<string, number> = {}) {
  const values: Record<string, number> = {
    maxBatchSize: 500,
    clockDriftToleranceSeconds: 300,
    ingestRateLimitPerMinute: 120,
    ...overrides,
  };

  return { get: jest.fn((key: string) => values[key]) } as unknown as ConfigService;
}

/** Payload contoh; timestamp tetap agar hasilnya dapat diulang. */
const TS_BASE = 1757308800; // 2025-09-08T04:00:00Z

function buildPayload(ts: number, seq: number) {
  return {
    ts,
    seq,
    battery_v: 3.92,
    rssi: -71,
    readings: [
      { s: 'temp_air', v: 27.4 },
      { s: 'humidity', v: 82.1 },
    ],
  };
}

// ---------------------------------------------------------------------------
// Uji
// ---------------------------------------------------------------------------

describe('IngestionService — idempotensi', () => {
  it('pengiriman pertama: semua diterima', async () => {
    const { prisma, calls } = createPrismaStub({ insertedCount: 'all' });
    const service = new IngestionService(prisma, createReferenceStub(), createConfigStub());

    const hasil = await service.ingestBatch(DEVICE, {
      device_id: 'WS-GRT-001',
      fw: '1.4.2',
      batch: [buildPayload(TS_BASE, 10432), buildPayload(TS_BASE + 60, 10433)],
    });

    expect(hasil.accepted).toBe(4); // 2 sampel x 2 sensor
    expect(hasil.duplicated).toBe(0);
    expect(hasil.rejected).toBe(0);
    expect(calls).toHaveLength(1); // SATU bulk insert untuk seluruh batch
  });

  it('pengiriman ulang payload yang sama: semua terhitung duplikat, bukan error', async () => {
    // Skenario F.3 nomor 5: device tidak menerima ACK lalu mengirim ulang.
    // Yang dibutuhkan device sekarang adalah jawaban sukses supaya berhenti
    // mengulang — menjawab 4xx akan membuatnya mengulang selamanya.
    const { prisma } = createPrismaStub({ insertedCount: 0 });
    const service = new IngestionService(prisma, createReferenceStub(), createConfigStub());

    const hasil = await service.ingestBatch(DEVICE, {
      device_id: 'WS-GRT-001',
      batch: [buildPayload(TS_BASE, 10432), buildPayload(TS_BASE + 60, 10433)],
    });

    expect(hasil.accepted).toBe(0);
    expect(hasil.duplicated).toBe(4);
    expect(hasil.rejected).toBe(0);
  });

  it('batch separuh duplikat: sisanya tetap tersimpan', async () => {
    // Setiap record berdiri sendiri, sehingga device tidak perlu tahu bagian
    // mana dari batch-nya yang sudah sampai lebih dulu.
    const { prisma } = createPrismaStub({ insertedCount: 2 });
    const service = new IngestionService(prisma, createReferenceStub(), createConfigStub());

    const hasil = await service.ingestBatch(DEVICE, {
      device_id: 'WS-GRT-001',
      batch: [buildPayload(TS_BASE, 1), buildPayload(TS_BASE + 60, 2)],
    });

    expect(hasil.accepted).toBe(2);
    expect(hasil.duplicated).toBe(2);
  });

  it('menyerahkan dedup ke constraint database lewat skipDuplicates', async () => {
    // skipDuplicates diterjemahkan Prisma menjadi ON CONFLICT DO NOTHING.
    // Uji ini mengunci keputusan arsitektural: TIDAK ada SELECT lebih dulu,
    // karena cek-lalu-tulis punya celah balapan antara dua request bersamaan.
    const { prisma, calls, raw } = createPrismaStub();
    const service = new IngestionService(prisma, createReferenceStub(), createConfigStub());

    await service.ingestBatch(DEVICE, {
      device_id: 'WS-GRT-001',
      batch: [buildPayload(TS_BASE, 1)],
    });

    expect(calls[0].skipDuplicates).toBe(true);
    // Tidak ada metode pencarian yang dipanggil sebelum menulis.
    expect(raw.sensorReading).not.toHaveProperty('findMany');
  });

  it('menyusun kunci dedup dari device, tipe sensor, channel, dan waktu', async () => {
    const { prisma, calls } = createPrismaStub();
    const service = new IngestionService(prisma, createReferenceStub(), createConfigStub());

    await service.ingestBatch(DEVICE, {
      device_id: 'WS-GRT-001',
      batch: [buildPayload(TS_BASE, 1)],
    });

    for (const row of calls[0].data) {
      expect(row.deviceId).toBe(DEVICE.id);
      expect(row.channel).toBe(0);
      expect(row.deviceTime).toEqual(new Date(TS_BASE * 1000));
      expect(typeof row.sensorTypeId).toBe('number');
    }
  });

  it('seq BUKAN bagian dari kunci dedup', async () => {
    // Ini keputusan penting. `seq` reset ke 0 setiap device restart, sehingga
    // device yang restart dua kali sehari akan menghasilkan seq yang sama
    // untuk data berbeda. Memakainya sebagai kunci akan menolak data yang sah.
    const { prisma, calls } = createPrismaStub();
    const service = new IngestionService(prisma, createReferenceStub(), createConfigStub());

    await service.ingestBatch(DEVICE, {
      device_id: 'WS-GRT-001',
      batch: [buildPayload(TS_BASE, 10432)],
    });
    await service.ingestBatch(DEVICE, {
      device_id: 'WS-GRT-001',
      // Waktu SAMA, seq BERBEDA (device sempat restart).
      batch: [buildPayload(TS_BASE, 0)],
    });

    const kunciPertama = calls[0].data.map((r) => `${r.sensorTypeId}:${r.channel}:${String(r.deviceTime)}`);
    const kunciKedua = calls[1].data.map((r) => `${r.sensorTypeId}:${r.channel}:${String(r.deviceTime)}`);

    // Kuncinya identik walaupun seq-nya berbeda: baris kedua akan bentrok di
    // database dan terhitung duplikat.
    expect(kunciKedua).toEqual(kunciPertama);
    // seq tetap disimpan, hanya untuk diagnosa.
    expect(calls[0].data[0].seq).toBe(10432);
    expect(calls[1].data[0].seq).toBe(0);
  });
});

describe('IngestionService — urutan batch', () => {
  it('mengurutkan batch menurut ts sebelum menghitung delta hujan', async () => {
    // Soal menyebut data bisa datang TIDAK BERURUTAN. Kalau batch diproses
    // sesuai urutan kedatangan, setiap langkah mundur akan salah dikira
    // device restart dan total curah hujannya kacau.
    const { prisma, calls } = createPrismaStub();
    const service = new IngestionService(
      prisma,
      createReferenceStub(new Map([['6:0', 1000]])),
      createConfigStub(),
    );

    const rain = (ts: number, counter: number) => ({
      ts,
      seq: 1,
      readings: [{ s: 'rain_counter', v: counter }],
    });

    await service.ingestBatch(DEVICE, {
      device_id: 'WS-GRT-001',
      // Sengaja diacak: 3, 1, 2
      batch: [rain(TS_BASE + 120, 1006), rain(TS_BASE, 1002), rain(TS_BASE + 60, 1004)],
    });

    const rows = calls[0].data;

    // Baris keluar dalam urutan kronologis, bukan urutan kedatangan.
    expect(rows.map((r) => (r.deviceTime as Date).getTime())).toEqual([
      TS_BASE * 1000,
      (TS_BASE + 60) * 1000,
      (TS_BASE + 120) * 1000,
    ]);

    // Setiap langkah 2 jungkitan = 0.4 mm. Tidak ada yang dikira reset.
    expect(rows.map((r) => r.deltaValue)).toEqual([0.4, 0.4, 0.4]);
    for (const row of rows) {
      expect(describeFlags(row.qualityFlags as number)).not.toContain('COUNTER_RESET');
    }
  });

  it('menandai bucket agregat jam dan hari untuk setiap pembacaan', async () => {
    const { prisma, dirtyBuckets } = createPrismaStub();
    const service = new IngestionService(prisma, createReferenceStub(), createConfigStub());

    await service.ingestBatch(DEVICE, {
      device_id: 'WS-GRT-001',
      batch: [buildPayload(TS_BASE, 1)],
    });

    // 2 sensor x 2 lebar bucket (HOUR_1 dan DAY_1)
    expect(dirtyBuckets).toHaveLength(4);
  });
});

describe('IngestionService — penolakan', () => {
  it('menolak batch yang melebihi MAX_BATCH_SIZE dengan 413', async () => {
    // F.3 nomor 8: batch berisi 500 record. Batas dibuat agar penggunaan
    // memori per request punya batas atas yang pasti.
    const { prisma } = createPrismaStub();
    const service = new IngestionService(
      prisma,
      createReferenceStub(),
      createConfigStub({ maxBatchSize: 100 }),
    );

    const batch = Array.from({ length: 101 }, (_, i) => buildPayload(TS_BASE + i * 60, i));

    await expect(
      service.ingestBatch(DEVICE, { device_id: 'WS-GRT-001', batch }),
    ).rejects.toMatchObject({
      code: ErrorCode.BATCH_TOO_LARGE,
      status: HttpStatus.PAYLOAD_TOO_LARGE,
    });
  });

  it('menerima batch yang tepat sebesar batas', async () => {
    const { prisma } = createPrismaStub();
    const service = new IngestionService(
      prisma,
      createReferenceStub(),
      createConfigStub({ maxBatchSize: 100 }),
    );

    const batch = Array.from({ length: 100 }, (_, i) => buildPayload(TS_BASE + i * 60, i));
    const hasil = await service.ingestBatch(DEVICE, { device_id: 'WS-GRT-001', batch });

    expect(hasil.accepted).toBe(200);
  });

  it('menolak payload yang device_id-nya tidak cocok dengan kredensial', async () => {
    // Kredensial membuktikan device MANA yang mengirim; field device_id di
    // payload hanyalah klaim. Tanpa pemeriksaan ini, kredensial yang bocor
    // bisa menulis data atas nama stasiun mana pun.
    const { prisma } = createPrismaStub();
    const service = new IngestionService(prisma, createReferenceStub(), createConfigStub());

    await expect(
      service.ingestBatch(DEVICE, {
        device_id: 'WS-LAIN-999',
        batch: [buildPayload(TS_BASE, 1)],
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.DEVICE_MISMATCH,
      status: HttpStatus.FORBIDDEN,
    });
  });

  it('F.3 kasus 7 — sensor yang tidak dikirim tidak menghasilkan baris apa pun', async () => {
    const { prisma, calls } = createPrismaStub();
    const service = new IngestionService(prisma, createReferenceStub(), createConfigStub());

    await service.ingestBatch(DEVICE, {
      device_id: 'WS-GRT-001',
      batch: [{ ts: TS_BASE, seq: 1, readings: [{ s: 'temp_air', v: 27.4 }] }],
    });

    // Hanya satu baris. Tidak ada baris kosong, tidak ada NULL pengganti —
    // ketiadaan data terekam sebagai ketiadaan baris.
    expect(calls[0].data).toHaveLength(1);
    expect(calls[0].data[0].sensorTypeId).toBe(SENSOR_TYPES.temp_air.id);
  });

  it('tipe sensor asing ditolak per-item, sensor lain di payload tetap diproses', async () => {
    const { prisma, calls } = createPrismaStub();
    const service = new IngestionService(prisma, createReferenceStub(), createConfigStub());

    const hasil = await service.ingestBatch(DEVICE, {
      device_id: 'WS-GRT-001',
      batch: [
        {
          ts: TS_BASE,
          seq: 1,
          readings: [
            { s: 'temp_air', v: 27.4 },
            { s: 'sensor_antah_berantah', v: 1 },
          ],
        },
      ],
    });

    expect(hasil.accepted).toBe(1);
    expect(hasil.rejected).toBe(1);
    expect(hasil.errors[0].code).toBe(ErrorCode.UNKNOWN_SENSOR_TYPE);
    expect(hasil.errors[0].sensor).toBe('sensor_antah_berantah');
    expect(calls[0].data).toHaveLength(1);
  });

  it('menolak timestamp yang lebih dari 24 jam di masa depan', async () => {
    const { prisma } = createPrismaStub();
    const service = new IngestionService(prisma, createReferenceStub(), createConfigStub());

    const jauhDiDepan = Math.floor(Date.now() / 1000) + 48 * 3600;
    const hasil = await service.ingestBatch(DEVICE, {
      device_id: 'WS-GRT-001',
      batch: [buildPayload(jauhDiDepan, 1)],
    });

    expect(hasil.accepted).toBe(0);
    expect(hasil.rejected).toBe(1);
    expect(hasil.errors[0].code).toBe('TIMESTAMP_TOO_FAR_IN_FUTURE');
  });

  it('menerima timestamp 2 jam di depan dengan flag, tidak menolaknya', async () => {
    // F.3 kasus 1: jam device maju 2 jam. Diterima dengan tanda — datanya
    // masih berguna, dan yang perlu dicatat adalah jamnya tidak bisa dipercaya.
    const { prisma, calls } = createPrismaStub();
    const service = new IngestionService(prisma, createReferenceStub(), createConfigStub());

    const duaJamDiDepan = Math.floor(Date.now() / 1000) + 2 * 3600;
    const hasil = await service.ingestBatch(DEVICE, {
      device_id: 'WS-GRT-001',
      batch: [buildPayload(duaJamDiDepan, 1)],
    });

    expect(hasil.rejected).toBe(0);
    expect(hasil.accepted).toBe(2);
    expect(describeFlags(calls[0].data[0].qualityFlags as number)).toContain('FUTURE_TIMESTAMP');
  });

  it('menjawab 503 ketika database tidak terjangkau, bukan 500', async () => {
    // Bedanya menentukan nasib data: 503 memberi tahu device bahwa ini
    // gangguan sementara dan payloadnya layak dikirim ulang, sehingga datanya
    // tetap aman di buffer device.
    const { prisma } = createPrismaStub({ throwOnInsert: { code: 'P1001' } });
    const service = new IngestionService(prisma, createReferenceStub(), createConfigStub());

    await expect(
      service.ingestBatch(DEVICE, { device_id: 'WS-GRT-001', batch: [buildPayload(TS_BASE, 1)] }),
    ).rejects.toMatchObject({
      code: ErrorCode.SERVICE_UNAVAILABLE,
      status: HttpStatus.SERVICE_UNAVAILABLE,
    });
  });

  it('meneruskan error tak terduga apa adanya', async () => {
    // Hanya kegagalan koneksi yang diterjemahkan menjadi 503. Error lain
    // harus tetap naik supaya tidak tersamar sebagai gangguan sementara.
    const bug = new Error('bug di kode kita sendiri');
    const { prisma } = createPrismaStub({ throwOnInsert: bug });
    const service = new IngestionService(prisma, createReferenceStub(), createConfigStub());

    await expect(
      service.ingestBatch(DEVICE, { device_id: 'WS-GRT-001', batch: [buildPayload(TS_BASE, 1)] }),
    ).rejects.toThrow(bug);
    await expect(
      service.ingestBatch(DEVICE, { device_id: 'WS-GRT-001', batch: [buildPayload(TS_BASE, 1)] }),
    ).rejects.not.toBeInstanceOf(ApiException);
  });
});
