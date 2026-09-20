import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BucketWidth, DeviceStatus, Prisma } from '@prisma/client';
import { ApiException } from '../common/errors/api.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedDevice } from '../auth/device-auth.guard';
import { findEffectiveCalibration } from './domain/calibration';
import { evaluateReading, evaluateTimestampFlags } from './domain/evaluate-reading';
import { QualityFlag } from './domain/quality-flags';
import {
  parseSensorKey,
  ReferenceDataService,
  slotKey,
  type SensorSlot,
} from './reference-data.service';
import type {
  IngestHeartbeatDto,
  IngestTelemetryBatchDto,
  IngestTelemetryDto,
  TelemetrySampleDto,
} from './dto/ingest.dto';

/** Satu record yang ditolak, dengan alasan yang bisa dibaca mesin. */
export interface RejectedRecord {
  /** Posisi record dalam array `batch` (0 untuk payload tunggal). */
  index: number;
  /** Kunci sensor yang bermasalah; null bila masalahnya di tingkat record. */
  sensor: string | null;
  code: string;
  message: string;
}

export interface IngestResult {
  accepted: number;
  duplicated: number;
  rejected: number;
  errors: RejectedRecord[];
  device_time_range: { from: string; to: string } | null;
}

/**
 * Batas seberapa jauh ke depan `device_time` masih boleh diterima.
 *
 * Di bawah ambang ini, timestamp masa depan hanya DITANDAI (FUTURE_TIMESTAMP)
 * dan datanya tetap disimpan — jam device yang meleset satu-dua jam masih
 * lebih berguna daripada data yang hilang. Di atasnya, jamnya jelas rusak dan
 * menerimanya berarti menyuntikkan titik data ke masa depan yang akan
 * mengacaukan sumbu semua chart untuk waktu yang lama.
 */
const MAX_FUTURE_DRIFT_SECONDS = 24 * 3600;

/** Curah hujan per pembacaan di atas 20 mm hampir pasti pencacah yang rusak. */
const MAX_PLAUSIBLE_RAIN_DELTA_MM = 20;

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reference: ReferenceDataService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Payload tunggal diproses lewat jalur yang sama persis dengan batch, hanya
   * dengan satu elemen.
   *
   * Sengaja tidak dibuat jalur cepat tersendiri: dua implementasi berarti dua
   * tempat yang harus sama-sama benar soal dedup, kalibrasi, dan counter reset
   * — dan cepat atau lambat keduanya akan berbeda perilaku.
   */
  async ingestSingle(device: AuthenticatedDevice, dto: IngestTelemetryDto): Promise<IngestResult> {
    const { device_id, fw, ...sample } = dto;
    return this.ingestBatch(device, { device_id, fw, batch: [sample as TelemetrySampleDto] });
  }

  async ingestBatch(
    device: AuthenticatedDevice,
    dto: IngestTelemetryBatchDto,
  ): Promise<IngestResult> {
    this.assertDeviceMatches(device, dto.device_id);

    const maxBatchSize = this.config.get<number>('maxBatchSize') ?? 500;
    if (dto.batch.length > maxBatchSize) {
      throw new ApiException(
        ErrorCode.BATCH_TOO_LARGE,
        `Batch berisi ${dto.batch.length} record, melebihi batas ${maxBatchSize}`,
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }

    const serverTime = new Date();
    const errors: RejectedRecord[] = [];

    // --- Urutkan menurut waktu -------------------------------------------
    // WAJIB dilakukan sebelum apa pun yang lain. Perhitungan delta pencacah
    // hujan membandingkan setiap record dengan record sebelumnya; kalau
    // urutannya acak, setiap langkah mundur akan salah dikira device restart
    // dan total hujannya kacau. Soal secara eksplisit menyebut data bisa
    // datang tidak berurutan, jadi ini bukan kemungkinan teoretis.
    //
    // Indeks aslinya dibawa serta supaya pesan error tetap menunjuk posisi
    // record di dalam payload yang dikirim device, bukan posisi setelah
    // diurutkan.
    const samples = dto.batch
      .map((sample, index) => ({ sample, index }))
      .sort((a, b) => a.sample.ts - b.sample.ts);

    const sensorTypes = await this.reference.getSensorTypesByKey();

    // --- Saring record yang timestamp-nya tidak bisa dipakai --------------
    const usable: Array<{ sample: TelemetrySampleDto; index: number; deviceTime: Date }> = [];

    for (const entry of samples) {
      const deviceTime = new Date(entry.sample.ts * 1000);
      const driftSeconds = (deviceTime.getTime() - serverTime.getTime()) / 1000;

      if (driftSeconds > MAX_FUTURE_DRIFT_SECONDS) {
        errors.push({
          index: entry.index,
          sensor: null,
          code: 'TIMESTAMP_TOO_FAR_IN_FUTURE',
          message:
            `device_time ${deviceTime.toISOString()} lebih maju dari waktu server ` +
            `sekitar ${Math.round(driftSeconds / 3600)} jam; jam device perlu disinkronkan`,
        });
        continue;
      }

      usable.push({ ...entry, deviceTime });
    }

    if (usable.length === 0) {
      return {
        accepted: 0,
        duplicated: 0,
        rejected: errors.length,
        errors,
        device_time_range: null,
      };
    }

    const from = usable[0].deviceTime;
    const to = usable[usable.length - 1].deviceTime;

    // --- Muat data master sekali untuk seluruh batch ----------------------
    const installations = await this.reference.loadInstallations(device.id, from, to);

    const sensorIds = [...installations.values()].flat().map((row) => row.sensorId);
    const calibrations = await this.reference.loadCalibrations(sensorIds);

    // Nilai pencacah terakhir sebelum batch ini, sebagai acuan record pertama.
    const cumulativeSlots = this.collectCumulativeSlots(usable, sensorTypes);
    const previousCumulative = await this.reference.loadPreviousCumulativeValues(
      device.id,
      cumulativeSlots,
      from,
    );

    // --- Susun baris yang akan ditulis ------------------------------------
    const rows: Prisma.SensorReadingCreateManyInput[] = [];
    const dirtyBuckets = new Map<string, Prisma.AggregateDirtyBucketCreateManyInput>();

    const deviceMaintenanceFlag =
      device.status === DeviceStatus.MAINTENANCE ? QualityFlag.DEVICE_MAINTENANCE : 0;

    for (const { sample, index, deviceTime } of usable) {
      const timestampFlags = evaluateTimestampFlags({
        deviceTime,
        serverTime,
        clockDriftToleranceSeconds: this.config.get<number>('clockDriftToleranceSeconds') ?? 300,
      });

      for (const item of sample.readings) {
        const { key, channel } = parseSensorKey(item.s);
        const sensorType = sensorTypes.get(key);

        if (!sensorType) {
          // Tipe sensor tidak dikenal: record LAIN dalam payload yang sama
          // tetap diproses. Satu sensor asing tidak boleh membuang enam
          // pembacaan yang sah di sebelahnya.
          errors.push({
            index,
            sensor: item.s,
            code: ErrorCode.UNKNOWN_SENSOR_TYPE,
            message: `Tipe sensor "${key}" belum terdaftar di master data`,
          });
          continue;
        }

        const slot = slotKey(sensorType.id, channel);
        const installation = ReferenceDataService.resolveInstallationAt(
          installations.get(slot),
          deviceTime,
        );

        const calibration = installation
          ? findEffectiveCalibration(calibrations.get(installation.sensorId) ?? [], deviceTime)
          : null;

        const evaluated = evaluateReading({
          rawValue: item.v,
          sensorType,
          calibration,
          previousCumulativeRaw: sensorType.isCumulative
            ? (previousCumulative.get(slot) ?? null)
            : null,
          maxPlausibleDelta: sensorType.isCumulative ? MAX_PLAUSIBLE_RAIN_DELTA_MM : null,
          baseFlags:
            timestampFlags |
            deviceMaintenanceFlag |
            (installation ? 0 : QualityFlag.NO_INSTALLATION),
        });

        // Acuan untuk record berikutnya dalam batch yang sama. Diperbarui
        // hanya bila nilainya sah — kalau sensor mengirim sentinel -999,
        // memakainya sebagai acuan akan membuat pembacaan berikutnya dikira
        // lonjakan raksasa.
        if (sensorType.isCumulative && evaluated.value !== null) {
          previousCumulative.set(slot, item.v);
        }

        rows.push({
          deviceTime,
          serverTime,
          deviceId: device.id,
          sensorTypeId: sensorType.id,
          channel,
          sensorId: installation?.sensorId ?? null,
          installationId: installation?.installationId ?? null,
          rawValue: evaluated.rawValue,
          value: evaluated.value,
          deltaValue: evaluated.deltaValue,
          qualityFlags: evaluated.qualityFlags,
          seq: sample.seq ?? null,
          calibrationId: evaluated.calibrationId,
        });

        this.collectDirtyBuckets(dirtyBuckets, device.id, sensorType.id, channel, deviceTime);
      }
    }

    if (rows.length === 0) {
      return {
        accepted: 0,
        duplicated: 0,
        rejected: errors.length,
        errors,
        device_time_range: { from: from.toISOString(), to: to.toISOString() },
      };
    }

    // --- Tulis: satu bulk insert untuk seluruh batch ----------------------
    //
    // `skipDuplicates` diterjemahkan Prisma menjadi ON CONFLICT DO NOTHING
    // terhadap primary key (device_id, sensor_type_id, channel, device_time) —
    // dan primary key itulah kunci idempotensi kita.
    //
    // Dedup diserahkan ke constraint database, BUKAN dengan SELECT lebih dulu.
    // Cek-lalu-tulis punya celah balapan: dua request identik yang datang
    // bersamaan sama-sama melihat "belum ada", lalu keduanya menulis.
    // Constraint tidak punya celah itu.
    let insertedCount: number;

    try {
      const result = await this.prisma.sensorReading.createMany({
        data: rows,
        skipDuplicates: true,
      });
      insertedCount = result.count;
    } catch (error) {
      if (PrismaService.isConnectionError(error)) {
        // Database tidak terjangkau. Dijawab 503, BUKAN 500 — bedanya penting:
        // 503 memberi tahu device bahwa ini gangguan sementara dan payloadnya
        // layak dikirim ulang, sehingga data tetap aman di buffer device.
        // Yang tidak boleh dilakukan adalah menjawab 2xx sebelum data
        // benar-benar tersimpan; device akan menghapus buffer-nya, dan di
        // situlah data hilang selamanya.
        throw new ApiException(
          ErrorCode.SERVICE_UNAVAILABLE,
          'Database sedang tidak tersedia, kirim ulang payload ini nanti',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      throw error;
    }

    const duplicated = rows.length - insertedCount;

    // --- Pekerjaan susulan ------------------------------------------------
    // Tidak satu pun dari ini boleh menggagalkan ingestion: datanya sudah
    // tersimpan, dan itu bagian yang tidak bisa diulang. Penandaan bucket dan
    // pembaruan metadata bersifat idempoten dan akan benar sendiri pada
    // payload berikutnya.
    await Promise.all([
      this.markDirtyBuckets([...dirtyBuckets.values()]),
      this.touchDeviceHealth(device, dto.fw, usable[usable.length - 1], to),
    ]).catch((error: unknown) => {
      this.logger.warn(
        `Pekerjaan susulan ingestion gagal untuk device ${device.deviceCode}: ${String(error)}`,
      );
    });

    return {
      accepted: insertedCount,
      duplicated,
      rejected: errors.length,
      errors,
      device_time_range: { from: from.toISOString(), to: to.toISOString() },
    };
  }

  /**
   * Heartbeat: bukti device hidup tanpa membawa data sensor.
   *
   * Endpoint terpisah ini yang membuat "device hidup tapi sensornya rusak"
   * bisa dibedakan dari "device mati" — kondisi yang tidak akan terbedakan
   * kalau satu-satunya bukti kehidupan adalah datangnya data sensor.
   */
  async ingestHeartbeat(
    device: AuthenticatedDevice,
    dto: IngestHeartbeatDto,
  ): Promise<{ device_time: string; server_time: string }> {
    this.assertDeviceMatches(device, dto.device_id);

    const serverTime = new Date();
    const deviceTime = new Date(dto.ts * 1000);

    await this.prisma.$transaction([
      this.prisma.deviceHeartbeat.upsert({
        where: { deviceId_deviceTime: { deviceId: device.id, deviceTime } },
        create: {
          deviceId: device.id,
          deviceTime,
          serverTime,
          batteryV: dto.battery_v ?? null,
          rssi: dto.rssi ?? null,
          uptimeS: dto.uptime_s ?? null,
          firmwareVersion: dto.fw ?? null,
          source: 'HEARTBEAT',
        },
        // Heartbeat yang dikirim ulang cukup diperbarui, bukan ditolak:
        // isinya memang menggambarkan kondisi pada detik yang sama.
        update: { serverTime, batteryV: dto.battery_v ?? null, rssi: dto.rssi ?? null },
      }),
      this.prisma.device.update({
        where: { id: device.id },
        data: {
          lastSeenAt: deviceTime,
          lastBatteryV: dto.battery_v ?? undefined,
          lastRssi: dto.rssi ?? undefined,
          firmwareVersion: dto.fw ?? undefined,
        },
      }),
    ]);

    return { device_time: deviceTime.toISOString(), server_time: serverTime.toISOString() };
  }

  // ---------------------------------------------------------------------
  // Pembantu
  // ---------------------------------------------------------------------

  /**
   * Kredensial membuktikan device MANA yang mengirim; field `device_id` di
   * payload hanyalah klaim. Keduanya harus cocok.
   *
   * Tanpa pemeriksaan ini, device yang kredensialnya bocor bisa menulis data
   * atas nama stasiun mana pun — dan datanya akan terlihat sah sepenuhnya.
   */
  private assertDeviceMatches(device: AuthenticatedDevice, claimedDeviceId: string): void {
    if (device.deviceCode !== claimedDeviceId) {
      throw new ApiException(
        ErrorCode.DEVICE_MISMATCH,
        `Kredensial ini milik device "${device.deviceCode}", bukan "${claimedDeviceId}"`,
        HttpStatus.FORBIDDEN,
      );
    }
  }

  /** Slot kumulatif yang muncul dalam batch, untuk memuat nilai acuan sebelumnya. */
  private collectCumulativeSlots(
    samples: ReadonlyArray<{ sample: TelemetrySampleDto }>,
    sensorTypes: Map<string, { id: number; isCumulative: boolean }>,
  ): SensorSlot[] {
    const slots = new Map<string, SensorSlot>();

    for (const { sample } of samples) {
      for (const item of sample.readings) {
        const { key, channel } = parseSensorKey(item.s);
        const type = sensorTypes.get(key);
        if (type?.isCumulative) {
          slots.set(slotKey(type.id, channel), { sensorTypeId: type.id, channel });
        }
      }
    }

    return [...slots.values()];
  }

  /**
   * Mengumpulkan bucket jam dan hari yang tersentuh pembacaan ini.
   *
   * Di-dedup lewat Map supaya batch 180 record dari satu jam yang sama hanya
   * menghasilkan satu penanda, bukan 180.
   */
  private collectDirtyBuckets(
    target: Map<string, Prisma.AggregateDirtyBucketCreateManyInput>,
    deviceId: string,
    sensorTypeId: number,
    channel: number,
    deviceTime: Date,
  ): void {
    const buckets: Array<[BucketWidth, Date]> = [
      [BucketWidth.HOUR_1, truncateToHourUtc(deviceTime)],
      [BucketWidth.DAY_1, truncateToDayUtc(deviceTime)],
    ];

    for (const [bucketWidth, bucketStart] of buckets) {
      const key = `${sensorTypeId}:${channel}:${bucketWidth}:${bucketStart.toISOString()}`;
      target.set(key, { deviceId, sensorTypeId, channel, bucketWidth, bucketStart });
    }
  }

  private async markDirtyBuckets(
    buckets: Prisma.AggregateDirtyBucketCreateManyInput[],
  ): Promise<void> {
    if (buckets.length === 0) {
      return;
    }

    // skipDuplicates: menandai bucket yang sudah ditandai bukan error, dan
    // bukan pula pekerjaan tambahan.
    await this.prisma.aggregateDirtyBucket.createMany({ data: buckets, skipDuplicates: true });
  }

  /**
   * Memperbarui ringkasan kesehatan device dan menyimpan metadata yang
   * menumpang payload telemetri.
   *
   * `lastSeenAt` diisi dengan `device_time` TERBARU yang pernah diterima, dan
   * dijaga agar tidak pernah mundur. Kalau data buffered dari tiga jam lalu
   * diizinkan menimpanya, device yang baru saja mengirim justru akan terlihat
   * seolah sudah lama senyap.
   */
  private async touchDeviceHealth(
    device: AuthenticatedDevice,
    firmware: string | undefined,
    latest: { sample: TelemetrySampleDto; deviceTime: Date },
    latestDeviceTime: Date,
  ): Promise<void> {
    const operations: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.device.updateMany({
        where: {
          id: device.id,
          OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: latestDeviceTime } }],
        },
        data: {
          lastSeenAt: latestDeviceTime,
          lastBatteryV: latest.sample.battery_v ?? undefined,
          lastRssi: latest.sample.rssi ?? undefined,
          firmwareVersion: firmware ?? undefined,
        },
      }),
    ];

    // Metadata kesehatan yang menumpang telemetri tetap disimpan ke riwayat,
    // ditandai sumbernya agar bisa dibedakan dari heartbeat sungguhan.
    if (latest.sample.battery_v !== undefined || latest.sample.rssi !== undefined) {
      operations.push(
        this.prisma.deviceHeartbeat.createMany({
          data: [
            {
              deviceId: device.id,
              deviceTime: latest.deviceTime,
              batteryV: latest.sample.battery_v ?? null,
              rssi: latest.sample.rssi ?? null,
              firmwareVersion: firmware ?? null,
              source: 'TELEMETRY',
            },
          ],
          skipDuplicates: true,
        }),
      );
    }

    // Telemetri pertama dari device yang baru di-provisioning menandakan ia
    // sudah benar-benar terpasang dan bekerja, jadi statusnya naik otomatis
    // ke ACTIVE — lengkap dengan catatan di riwayat status.
    if (device.status === DeviceStatus.PROVISIONED) {
      operations.push(
        this.prisma.device.update({
          where: { id: device.id },
          data: { status: DeviceStatus.ACTIVE },
        }),
        this.prisma.deviceStatusHistory.create({
          data: {
            deviceId: device.id,
            fromStatus: DeviceStatus.PROVISIONED,
            toStatus: DeviceStatus.ACTIVE,
            reason: 'Telemetri pertama diterima dari device',
          },
        }),
      );
    }

    await this.prisma.$transaction(operations);
  }
}

/** Awal jam dalam UTC. */
export function truncateToHourUtc(date: Date): Date {
  const result = new Date(date);
  result.setUTCMinutes(0, 0, 0);
  return result;
}

/** Awal hari dalam UTC. */
export function truncateToDayUtc(date: Date): Date {
  const result = new Date(date);
  result.setUTCHours(0, 0, 0, 0);
  return result;
}
