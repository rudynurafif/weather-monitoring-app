/**
 * Seeder: data contoh agar dashboard tidak kosong saat pertama dibuka.
 *
 * Dijalankan otomatis setiap kali container API start (lihat
 * apps/api/docker-entrypoint.sh), sehingga WAJIB idempoten — menjalankannya
 * sepuluh kali harus menghasilkan keadaan yang sama dengan menjalankannya
 * sekali. Semua penulisan memakai upsert atau skipDuplicates, dan pembuatan
 * data historis dilewati kalau datanya sudah ada.
 *
 * Yang dibuat:
 *   - 7 tipe sensor sesuai spesifikasi payload
 *   - 25 lokasi dan 25 device beserta kredensialnya, dibaca dari
 *     tools/simulator/devices.json sebagai satu-satunya sumber kebenaran
 *   - 175 sensor fisik (7 per device) dengan riwayat pemasangan
 *   - riwayat kalibrasi, termasuk satu sensor yang kalibrasinya pernah diganti
 *   - data historis 7 hari, lengkap dengan anomali yang disengaja
 *
 * Catatan penting: seeder memakai fungsi evaluasi yang SAMA PERSIS dengan
 * jalur ingestion (`evaluateReading`). Jadi kalau logika counter reset atau
 * quality flag diubah, data contoh ikut berubah dengan cara yang sama — tidak
 * ada versi kedua dari logika yang sama yang bisa diam-diam berbeda.
 */
import { randomBytes, scryptSync } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DeviceStatus, Prisma, PrismaClient, SensorStatus } from '@prisma/client';
import { hashSecret } from '../src/auth/device-key.util';
import { findEffectiveCalibration, type EffectiveCalibration } from '../src/ingestion/domain/calibration';
import { evaluateReading, type SensorTypeSpec } from '../src/ingestion/domain/evaluate-reading';
import { buildRecomputeSql } from '../src/aggregation/recompute-buckets';

/**
 * Memuat berkas .env dari root monorepo.
 *
 * Diperlukan karena seeder dijalankan sebagai skrip lepas lewat tsx, bukan
 * lewat Nest yang punya ConfigModule. Di dalam container tidak ada berkas .env
 * sama sekali - seluruh konfigurasi datang dari docker-compose - jadi
 * ketiadaannya bukan error.
 *
 * Nilai yang sudah ada di environment TIDAK ditimpa, supaya variabel dari
 * docker-compose atau dari baris perintah selalu menang atas isi berkas.
 */
function loadEnvFile(): void {
  for (const candidate of [join(__dirname, '..', '..', '..', '.env'), join(process.cwd(), '.env')]) {
    if (!existsSync(candidate)) {
      continue;
    }

    for (const line of readFileSync(candidate, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith('#')) {
        continue;
      }

      const separator = trimmed.indexOf('=');
      if (separator <= 0) {
        continue;
      }

      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, '');

      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }

    return;
  }
}

loadEnvFile();

const prisma = new PrismaClient();

/**
 * Hash password pengguna dashboard.
 *
 * Formatnya `scrypt$N$r$p$salt$hash` supaya parameternya ikut tersimpan
 * bersama hash - dengan begitu biaya kerja bisa dinaikkan di kemudian hari
 * tanpa membuat password lama gagal diverifikasi.
 */
function hashPassword(plain: string): string {
  const N = 16384;
  const r = 8;
  const p = 1;
  const salt = randomBytes(16);
  const derived = scryptSync(plain, salt, 64, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

/** Berapa hari ke belakang data historis dibuat. Ketentuan: minimal 7 hari. */
const HISTORY_DAYS = 7;

/**
 * Jarak antar sampel data historis, dalam menit.
 *
 * Device sungguhan mengirim tiap 60 detik, dan simulator pun begitu. Data
 * historis sengaja dibuat per 5 menit: 7 hari x 22 device berdata x 7 sensor
 * pada resolusi satu menit berarti sekitar 1,5 juta baris yang membuat
 * `docker compose up` pertama terasa lama, sementara untuk chart 5 menit sudah
 * lebih dari cukup (288 titik per hari). Pada resolusi 5 menit jumlahnya
 * sekitar 325.000 baris dan seeder selesai dalam kisaran setengah menit.
 * Pilihan ini dicatat di README.
 */
const HISTORY_INTERVAL_MINUTES = 5;

const INSERT_CHUNK_SIZE = 5_000;

interface SeedDevice {
  device_code: string;
  name: string;
  key_id: string;
  secret: string;
  /**
   * Status awal device. Sebagian besar ACTIVE; satu stasiun sengaja dibuat
   * MAINTENANCE agar filter status di halaman manajemen punya sesuatu untuk
   * disaring, dan agar terlihat bahwa device yang sedang diservis tetap
   * menerima data - hanya saja pembacaannya ditandai.
   */
  status?: 'PROVISIONED' | 'ACTIVE' | 'MAINTENANCE' | 'DECOMMISSIONED';
  location: { name: string; latitude: number; longitude: number; altitude_m: number };
}

// ---------------------------------------------------------------------------
// Master data tipe sensor
// ---------------------------------------------------------------------------

const SENSOR_TYPES = [
  {
    key: 'temp_air',
    displayName: 'Suhu Udara',
    unit: '°C',
    minValid: -20,
    maxValid: 60,
    precision: 1,
    isCumulative: false,
    unitPerCount: null,
    isCircular: false,
  },
  {
    key: 'humidity',
    displayName: 'Kelembapan Relatif',
    unit: '%',
    minValid: 0,
    maxValid: 100,
    precision: 1,
    isCumulative: false,
    unitPerCount: null,
    isCircular: false,
  },
  {
    key: 'pressure',
    displayName: 'Tekanan Udara',
    unit: 'hPa',
    // Sensor mengukur tekanan di lokasinya (station pressure), bukan tekanan
    // yang sudah direduksi ke permukaan laut - dan nilai itu turun seiring
    // ketinggian. Batas bawah satu jaringan harus menampung stasiun tertinggi
    // di dalamnya: di Dieng (2.093 m) tekanan wajarnya sekitar 786 hPa, jadi
    // batas 800 yang dipakai sebelumnya menandai SELURUH pembacaan stasiun itu
    // sebagai OUT_OF_RANGE. 500 hPa setara ketinggian sekitar 5.500 m, di atas
    // stasiun permukaan mana pun di Indonesia, dan tetap menangkap sensor rusak
    // yang biasanya membaca 0 atau mentok di batas chip-nya (300 atau 1100).
    minValid: 500,
    maxValid: 1100,
    precision: 1,
    isCumulative: false,
    unitPerCount: null,
    isCircular: false,
  },
  {
    key: 'wind_speed',
    displayName: 'Kecepatan Angin',
    unit: 'm/s',
    minValid: 0,
    maxValid: 75,
    precision: 1,
    isCumulative: false,
    unitPerCount: null,
    isCircular: false,
  },
  {
    key: 'wind_dir',
    displayName: 'Arah Angin',
    unit: '°',
    minValid: 0,
    maxValid: 359,
    precision: 0,
    isCumulative: false,
    unitPerCount: null,
    // Besaran melingkar: rata-rata 350° dan 10° bukan 180°.
    isCircular: true,
  },
  {
    key: 'rain_counter',
    displayName: 'Curah Hujan (tipping bucket)',
    unit: 'mm',
    // Rentangnya adalah rentang NILAI PENCACAH, bukan curah hujan. Pencacah
    // hanya naik dan direset saat restart, jadi batas atasnya besar.
    minValid: 0,
    maxValid: 1_000_000,
    precision: 1,
    isCumulative: true,
    unitPerCount: 0.2,
    isCircular: false,
  },
  {
    key: 'solar_rad',
    displayName: 'Radiasi Matahari',
    unit: 'W/m²',
    minValid: 0,
    maxValid: 1500,
    precision: 1,
    isCumulative: false,
    unitPerCount: null,
    isCircular: false,
  },
] as const;

// ---------------------------------------------------------------------------
// Pembangkit cuaca buatan
// ---------------------------------------------------------------------------

/**
 * Bilangan acak yang DAPAT DIULANG.
 *
 * Memakai Math.random() akan membuat setiap orang yang menjalankan seeder
 * melihat grafik yang berbeda, sehingga "kenapa di tempat saya angkanya lain"
 * menjadi pertanyaan yang mustahil ditelusuri. Dengan generator berbasis benih,
 * data contoh selalu sama persis di mesin mana pun.
 */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    // xorshift32 — sederhana, cukup acak untuk data contoh.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };
}

/** Posisi matahari kasar: 0 saat tengah malam, 1 saat tengah hari (WIB). */
function solarFactor(date: Date): number {
  // Jam lokal WIB = UTC + 7. Pola harian cuaca mengikuti matahari setempat,
  // bukan UTC, jadi pergeseran ini perlu meski penyimpanannya tetap UTC.
  const hourWib = (date.getUTCHours() + 7 + date.getUTCMinutes() / 60) % 24;
  const factor = Math.sin(((hourWib - 6) / 12) * Math.PI);
  return Math.max(0, factor);
}

interface WeatherSample {
  temp_air: number;
  humidity: number;
  pressure: number;
  wind_speed: number;
  wind_dir: number;
  solar_rad: number;
  /** Jumlah jungkitan tipping bucket sejak sampel sebelumnya. */
  rainTips: number;
}

function generateWeather(
  date: Date,
  altitudeM: number,
  random: () => number,
): WeatherSample {
  const sun = solarFactor(date);

  // Suhu turun sekitar 6,5 °C tiap 1000 m — itulah sebabnya Lembang yang
  // berada di 1312 m selalu lebih dingin daripada Cirebon yang di tepi laut.
  const lapseRate = (altitudeM / 1000) * 6.5;
  const tempAir = 24 + 7 * sun - lapseRate + (random() - 0.5) * 1.5;

  // Kelembapan berbanding terbalik dengan suhu.
  const humidity = Math.min(99, Math.max(35, 92 - 35 * sun + (random() - 0.5) * 6));

  // Rumus barometrik atmosfer standar. Pendekatan linear "12 hPa tiap 100 m"
  // hanya berlaku dekat permukaan laut; makin tinggi, penurunan per 100 m
  // makin kecil karena udaranya makin tipis. Di Dieng (2.093 m) pendekatan
  // linear meleset sekitar 24 hPa dan menghasilkan tekanan yang tidak mungkin.
  const stationPressure = 1013.25 * Math.pow(1 - 2.25577e-5 * altitudeM, 5.25588);
  const pressure = stationPressure + Math.sin(sun * Math.PI) * 2 + (random() - 0.5);

  const windSpeed = Math.max(0, 1.5 + 3 * sun + (random() - 0.5) * 2);

  // Arah angin bergoyang di sekitar utara supaya data contoh ikut memuat
  // perlintasan 0°/360° — persoalan yang membuat rata-rata aritmetika salah.
  const windDir = (350 + Math.sin(date.getTime() / 3.6e6) * 25 + random() * 10 + 360) % 360;

  const solarRad = sun * 900 + (sun > 0 ? (random() - 0.5) * 60 : 0);

  // Hujan sore hari khas tropis: peluang membesar antara pukul 14–18 WIB.
  const hourWib = (date.getUTCHours() + 7) % 24;
  const rainChance = hourWib >= 14 && hourWib <= 18 ? 0.18 : 0.02;
  const rainTips = random() < rainChance ? Math.floor(random() * 8) + 1 : 0;

  return {
    temp_air: round(tempAir, 1),
    humidity: round(humidity, 1),
    pressure: round(pressure, 1),
    wind_speed: round(windSpeed, 1),
    // Modulo 360 SETELAH pembulatan: tanpa ini, 359.7 membulat menjadi 360 dan
    // melanggar rentang valid 0-359 milik tipe sensornya.
    wind_dir: Math.round(windDir) % 360,
    solar_rad: round(Math.max(0, solarRad), 1),
    rainTips,
  };
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// ---------------------------------------------------------------------------
// Seeder
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const pepper = process.env.DEVICE_KEY_PEPPER ?? 'insecure-dev-pepper-change-me';

  const seedFile = join(__dirname, '..', '..', '..', 'tools', 'simulator', 'devices.json');
  const seedDevices: SeedDevice[] = JSON.parse(readFileSync(seedFile, 'utf8')).devices;

  console.log('==> Menanam tipe sensor...');
  const sensorTypes = new Map<string, SensorTypeSpec>();

  for (const type of SENSOR_TYPES) {
    const row = await prisma.sensorType.upsert({
      where: { key: type.key },
      create: { ...type },
      // Master data diperbarui agar perubahan rentang valid ikut berlaku saat
      // seeder dijalankan ulang, tanpa menghapus sensor yang sudah menunjuknya.
      update: {
        displayName: type.displayName,
        unit: type.unit,
        minValid: type.minValid,
        maxValid: type.maxValid,
        precision: type.precision,
        isCumulative: type.isCumulative,
        unitPerCount: type.unitPerCount,
        isCircular: type.isCircular,
      },
    });
    sensorTypes.set(row.key, row);
  }

  console.log('==> Menanam pengguna dashboard...');
  await prisma.user.upsert({
    where: { email: 'admin@weather.local' },
    create: {
      email: 'admin@weather.local',
      // Password contoh: "admin12345". Di-hash dengan scrypt - KDF yang
      // sengaja lambat, kebalikan dari SHA-256 yang dipakai untuk secret
      // device. Bedanya karena password buatan manusia entropinya rendah dan
      // memang perlu dibuat mahal untuk ditebak berulang kali.
      passwordHash: hashPassword('admin12345'),
      fullName: 'Administrator',
      role: 'ADMIN',
    },
    update: {},
  });

  const now = new Date();
  const historyStart = new Date(now.getTime() - HISTORY_DAYS * 24 * 3600 * 1000);
  // Pemasangan sensor dimulai jauh sebelum data historis, supaya setiap
  // pembacaan pasti menemukan instalasi yang berlaku.
  const installedAt = new Date(historyStart.getTime() - 30 * 24 * 3600 * 1000);

  for (const [deviceIndex, seedDevice] of seedDevices.entries()) {
    console.log(`==> Menanam device ${seedDevice.device_code}...`);

    const location = await prisma.location.upsert({
      where: { name: seedDevice.location.name },
      create: {
        name: seedDevice.location.name,
        latitude: new Prisma.Decimal(seedDevice.location.latitude),
        longitude: new Prisma.Decimal(seedDevice.location.longitude),
        altitudeM: new Prisma.Decimal(seedDevice.location.altitude_m),
        description: `Lokasi contoh hasil seeder untuk ${seedDevice.name}`,
      },
      update: {},
    });

    const device = await prisma.device.upsert({
      where: { deviceCode: seedDevice.device_code },
      create: {
        deviceCode: seedDevice.device_code,
        name: seedDevice.name,
        locationId: location.id,
        status: (seedDevice.status ?? 'ACTIVE') as DeviceStatus,
        firmwareVersion: '1.4.2',
        installedAt,
      },
      update: {
        locationId: location.id,
        name: seedDevice.name,
        status: (seedDevice.status ?? 'ACTIVE') as DeviceStatus,
      },
    });

    // Riwayat status: baris pertama selalu ada agar timeline device tidak
    // pernah kosong.
    const historyCount = await prisma.deviceStatusHistory.count({
      where: { deviceId: device.id },
    });
    if (historyCount === 0) {
      await prisma.deviceStatusHistory.createMany({
        data: [
          {
            deviceId: device.id,
            fromStatus: null,
            toStatus: DeviceStatus.PROVISIONED,
            reason: 'Device didaftarkan oleh seeder',
            changedAt: installedAt,
          },
          {
            deviceId: device.id,
            fromStatus: DeviceStatus.PROVISIONED,
            toStatus: DeviceStatus.ACTIVE,
            reason: 'Telemetri pertama diterima',
            changedAt: new Date(installedAt.getTime() + 3600 * 1000),
          },
          ...(device.status === DeviceStatus.MAINTENANCE
            ? [
                {
                  deviceId: device.id,
                  fromStatus: DeviceStatus.ACTIVE,
                  toStatus: DeviceStatus.MAINTENANCE,
                  reason: 'Penggantian sensor anemometer terjadwal',
                  changedAt: new Date(now.getTime() - 2 * 24 * 3600 * 1000),
                },
              ]
            : []),
        ],
      });
    }

    await prisma.deviceCredential.upsert({
      where: { keyId: seedDevice.key_id },
      create: {
        deviceId: device.id,
        keyId: seedDevice.key_id,
        secretHash: hashSecret(seedDevice.secret, pepper),
        secretPrefix: seedDevice.secret.slice(0, 12),
      },
      // Hash dihitung ulang karena pepper bisa berbeda antar lingkungan —
      // tanpa ini, mengganti DEVICE_KEY_PEPPER akan membuat simulator ditolak.
      update: { secretHash: hashSecret(seedDevice.secret, pepper) },
    });

    // --- Sensor fisik + pemasangan ------------------------------------
    const calibrationsBySensor = new Map<string, EffectiveCalibration[]>();
    const slotSensor = new Map<string, string>();

    for (const type of SENSOR_TYPES) {
      const sensorTypeRow = sensorTypes.get(type.key)!;
      const serialNumber = `${type.key.toUpperCase()}-${seedDevice.device_code.slice(-3)}`;

      const sensor = await prisma.sensor.upsert({
        where: { serialNumber },
        create: {
          serialNumber,
          sensorTypeId: sensorTypeRow.id,
          manufacturer: 'Contoh Instrument',
          model: `CI-${type.key}`,
          status: SensorStatus.INSTALLED,
        },
        update: {},
      });

      slotSensor.set(`${sensorTypeRow.id}:0`, sensor.id);

      const existingInstallation = await prisma.sensorInstallation.findFirst({
        where: { sensorId: sensor.id, removedAt: null },
      });

      if (!existingInstallation) {
        await prisma.sensorInstallation.create({
          data: {
            sensorId: sensor.id,
            deviceId: device.id,
            sensorTypeId: sensorTypeRow.id,
            channel: 0,
            installedAt,
            notes: 'Pemasangan awal oleh seeder',
          },
        });
      }

      // Kalibrasi. Sensor suhu pada device pertama sengaja diberi DUA periode
      // kalibrasi agar terlihat bahwa koreksi tidak berlaku surut: data
      // sebelum tanggal pergantian tetap memakai koreksi lama.
      const existingCalibration = await prisma.sensorCalibration.count({
        where: { sensorId: sensor.id },
      });

      if (existingCalibration === 0) {
        const changeover = new Date(now.getTime() - 3 * 24 * 3600 * 1000);
        const isDemoSensor = deviceIndex === 0 && type.key === 'temp_air';

        if (isDemoSensor) {
          await prisma.sensorCalibration.createMany({
            data: [
              {
                sensorId: sensor.id,
                offset: -0.4,
                scale: 1,
                effectiveFrom: installedAt,
                effectiveTo: changeover,
                notes: 'Kalibrasi pabrik',
              },
              {
                sensorId: sensor.id,
                offset: 0.3,
                scale: 1,
                effectiveFrom: changeover,
                effectiveTo: null,
                notes: 'Kalibrasi ulang lapangan setelah pembandingan dengan alat referensi',
              },
            ],
          });
        } else {
          await prisma.sensorCalibration.create({
            data: {
              sensorId: sensor.id,
              offset: 0,
              scale: 1,
              effectiveFrom: installedAt,
              effectiveTo: null,
              notes: 'Kalibrasi pabrik',
            },
          });
        }
      }

      calibrationsBySensor.set(
        sensor.id,
        await prisma.sensorCalibration.findMany({
          where: { sensorId: sensor.id },
          select: {
            id: true,
            offset: true,
            scale: true,
            effectiveFrom: true,
            effectiveTo: true,
          },
          orderBy: { effectiveFrom: 'desc' },
        }),
      );
    }

    // --- Data historis --------------------------------------------------
    //
    // Device berstatus PROVISIONED sengaja TIDAK diberi data. Statusnya berarti
    // sudah terdaftar tetapi belum dipasang di lapangan, jadi memberinya tujuh
    // hari pembacaan justru membuat statusnya berbohong. Sebagai efek
    // sampingnya, dashboard punya contoh nyata untuk empty state dan untuk
    // penanda "tidak mengirim data".
    if (device.status === DeviceStatus.PROVISIONED) {
      console.log('    berstatus PROVISIONED, belum dipasang: data historis dilewati');
      continue;
    }

    const existingReadings = await prisma.sensorReading.count({
      where: { deviceId: device.id, deviceTime: { gte: historyStart } },
    });

    if (existingReadings > 0) {
      console.log(
        `    data historis sudah ada (${existingReadings} baris), pembuatan dilewati`,
      );
      continue;
    }

    await seedHistory({
      device,
      seedDevice,
      deviceIndex,
      sensorTypes,
      slotSensor,
      calibrationsBySensor,
      historyStart,
      now,
      altitudeM: seedDevice.location.altitude_m,
    });
  }

  console.log('==> Menghitung agregat...');
  await recomputeAllAggregates();

  console.log('\nSelesai. Kredensial device untuk simulator:');
  for (const device of seedDevices) {
    console.log(`  ${device.device_code}  X-Device-Key: ${device.key_id}.${device.secret}`);
  }
  console.log('\nLogin dashboard: admin@weather.local / admin12345');
}

interface SeedHistoryArgs {
  device: { id: string };
  seedDevice: SeedDevice;
  deviceIndex: number;
  sensorTypes: Map<string, SensorTypeSpec>;
  slotSensor: Map<string, string>;
  calibrationsBySensor: Map<string, EffectiveCalibration[]>;
  historyStart: Date;
  now: Date;
  altitudeM: number;
}

/**
 * Membuat data historis satu device, lengkap dengan anomali yang disengaja.
 *
 * Anomalinya bukan hiasan: masing-masing mewakili satu kasus di Bagian F.3,
 * sehingga reviewer bisa melihat penanganannya pada data sungguhan alih-alih
 * hanya membaca klaimnya di dokumen.
 */
async function seedHistory(args: SeedHistoryArgs): Promise<void> {
  const {
    device,
    seedDevice,
    deviceIndex,
    sensorTypes,
    slotSensor,
    calibrationsBySensor,
    historyStart,
    now,
    altitudeM,
  } = args;

  // Benih diturunkan dari kode device agar tiap stasiun punya pola sendiri
  // yang tetap sama setiap kali seeder dijalankan.
  const random = createRandom(
    [...seedDevice.device_code].reduce((acc, char) => acc + char.charCodeAt(0), 7),
  );

  const stepMs = HISTORY_INTERVAL_MINUTES * 60 * 1000;
  const rows: Prisma.SensorReadingCreateManyInput[] = [];

  // --- Rencana anomali per device ---------------------------------------
  // Device 2: offline 3 jam pada hari ke-3 -> chart harus memperlihatkan gap.
  const gapStart = new Date(now.getTime() - 3 * 24 * 3600 * 1000);
  const gapEnd = new Date(gapStart.getTime() + 3 * 3600 * 1000);
  const hasGap = deviceIndex === 1;

  // Device 3: device restart pada hari ke-2 -> pencacah hujan kembali ke 0.
  const restartAt = new Date(now.getTime() - 2 * 24 * 3600 * 1000);
  const hasRestart = deviceIndex === 2;

  // Device 1: dua pembacaan cacat untuk memperagakan quality flag.
  const sensorErrorAt = new Date(now.getTime() - 26 * 3600 * 1000);
  const outOfRangeAt = new Date(now.getTime() - 20 * 3600 * 1000);
  const hasBadReadings = deviceIndex === 0;

  let rainCounter = 1000 + Math.floor(random() * 500);
  const previousRaw = new Map<string, number>();
  let seq = 0;

  for (let t = historyStart.getTime(); t <= now.getTime(); t += stepMs) {
    const deviceTime = new Date(t);
    seq += 1;

    if (hasGap && deviceTime >= gapStart && deviceTime < gapEnd) {
      // Device mati/terputus: tidak ada baris sama sekali. Ketiadaan baris
      // inilah yang membuat frontend bisa menggambar garis putus — berbeda
      // dari menyimpan nilai 0 yang akan terbaca sebagai "suhunya memang nol".
      continue;
    }

    if (hasRestart && Math.abs(deviceTime.getTime() - restartAt.getTime()) < stepMs) {
      // Pencacah tipping bucket kembali ke nol saat device menyala ulang.
      rainCounter = 0;
      seq = 0;
    }

    const weather = generateWeather(deviceTime, altitudeM, random);
    rainCounter += weather.rainTips;

    const samples: Array<[string, number]> = [
      ['temp_air', weather.temp_air],
      ['humidity', weather.humidity],
      ['pressure', weather.pressure],
      ['wind_speed', weather.wind_speed],
      ['wind_dir', weather.wind_dir],
      ['rain_counter', rainCounter],
      ['solar_rad', weather.solar_rad],
    ];

    for (const [key, rawValueBase] of samples) {
      const sensorType = sensorTypes.get(key)!;
      let rawValue = rawValueBase;

      // Kasus F.3 no. 2: sensor mengirim sentinel error, bukan pengukuran.
      if (
        hasBadReadings &&
        key === 'temp_air' &&
        Math.abs(deviceTime.getTime() - sensorErrorAt.getTime()) < stepMs
      ) {
        rawValue = -999;
      }

      // Kasus F.3 no. 3: nilai di luar rentang fisik yang mungkin.
      if (
        hasBadReadings &&
        key === 'humidity' &&
        Math.abs(deviceTime.getTime() - outOfRangeAt.getTime()) < stepMs
      ) {
        rawValue = 150;
      }

      const slot = `${sensorType.id}:0`;
      const sensorId = slotSensor.get(slot)!;
      const calibration = findEffectiveCalibration(
        calibrationsBySensor.get(sensorId) ?? [],
        deviceTime,
      );

      // Logika yang sama persis dengan jalur ingestion.
      const evaluated = evaluateReading({
        rawValue,
        sensorType,
        calibration,
        previousCumulativeRaw: sensorType.isCumulative ? (previousRaw.get(slot) ?? null) : null,
        maxPlausibleDelta: sensorType.isCumulative ? 20 : null,
      });

      if (sensorType.isCumulative && evaluated.value !== null) {
        previousRaw.set(slot, rawValue);
      }

      rows.push({
        deviceTime,
        // Data historis dianggap tiba tepat waktu.
        serverTime: deviceTime,
        deviceId: device.id,
        sensorTypeId: sensorType.id,
        channel: 0,
        sensorId,
        installationId: null,
        rawValue: evaluated.rawValue,
        value: evaluated.value,
        deltaValue: evaluated.deltaValue,
        qualityFlags: evaluated.qualityFlags,
        seq,
        calibrationId: evaluated.calibrationId,
      });
    }
  }

  console.log(`    menulis ${rows.length} pembacaan...`);

  for (let i = 0; i < rows.length; i += INSERT_CHUNK_SIZE) {
    await prisma.sensorReading.createMany({
      data: rows.slice(i, i + INSERT_CHUNK_SIZE),
      skipDuplicates: true,
    });
  }

  // Heartbeat: satu per jam, cukup untuk mengisi riwayat kesehatan.
  const heartbeats: Prisma.DeviceHeartbeatCreateManyInput[] = [];
  for (let t = historyStart.getTime(); t <= now.getTime(); t += 3600 * 1000) {
    const deviceTime = new Date(t);
    if (hasGap && deviceTime >= gapStart && deviceTime < gapEnd) {
      continue;
    }
    heartbeats.push({
      deviceId: device.id,
      deviceTime,
      serverTime: deviceTime,
      batteryV: round(3.7 + random() * 0.5, 2),
      rssi: -60 - Math.floor(random() * 35),
      uptimeS: BigInt(Math.floor((t - historyStart.getTime()) / 1000)),
      firmwareVersion: '1.4.2',
      source: 'HEARTBEAT',
    });
  }
  await prisma.deviceHeartbeat.createMany({ data: heartbeats, skipDuplicates: true });

  const lastRow = rows[rows.length - 1];
  await prisma.device.update({
    where: { id: device.id },
    data: {
      lastSeenAt: lastRow ? lastRow.deviceTime : null,
      lastBatteryV: 3.9,
      lastRssi: -71,
    },
  });

  // Tandai seluruh bucket yang tersentuh, lalu biarkan mesin agregasi yang
  // sama dengan jalur produksi menghitungnya.
  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO aggregate_dirty_bucket
        (device_id, sensor_type_id, channel, bucket_width, bucket_start, marked_at)
      SELECT DISTINCT
        r.device_id, r.sensor_type_id, r.channel, w.width,
        time_bucket(w.interval_value, r.device_time), now()
      FROM sensor_reading r
      CROSS JOIN (
        VALUES ('HOUR_1'::bucket_width, INTERVAL '1 hour'),
               ('DAY_1'::bucket_width,  INTERVAL '1 day')
      ) AS w(width, interval_value)
      WHERE r.device_id = ${device.id}::uuid
      ON CONFLICT DO NOTHING
    `,
  );
}

/** Menghabiskan antrean bucket kotor sampai kosong. */
async function recomputeAllAggregates(): Promise<void> {
  for (const width of ['HOUR_1', 'DAY_1'] as const) {
    let remaining = await prisma.aggregateDirtyBucket.count({ where: { bucketWidth: width } });
    console.log(`    ${width}: ${remaining} bucket perlu dihitung`);

    while (remaining > 0) {
      await prisma.$executeRaw(buildRecomputeSql(width, 2_000));
      const after = await prisma.aggregateDirtyBucket.count({ where: { bucketWidth: width } });

      // Penjaga: kalau satu putaran tidak mengurangi antrean sama sekali,
      // berhenti daripada berputar selamanya.
      if (after >= remaining) {
        break;
      }
      remaining = after;
    }
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error('Seeder gagal:', error);
    await prisma.$disconnect();
    process.exit(1);
  });
