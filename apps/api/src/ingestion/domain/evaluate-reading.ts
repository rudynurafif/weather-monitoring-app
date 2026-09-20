import { applyCalibration, type Calibration } from './calibration';
import { computeCumulativeDelta } from './cumulative-counter';
import { QualityFlag } from './quality-flags';

/**
 * Menggabungkan validasi rentang, kalibrasi, dan konversi pencacah kumulatif
 * menjadi satu keputusan untuk satu pembacaan.
 *
 * Seluruh isi file ini murni — tanpa database, tanpa `new Date()` tersembunyi.
 * Semua yang dibutuhkan dikirim lewat argumen. Itulah yang membuat kedelapan
 * kasus di Bagian F.3 bisa diuji sebagai unit test biasa.
 */

/** Bagian dari sensor_type yang dibutuhkan untuk menilai satu pembacaan. */
export interface SensorTypeSpec {
  id: number;
  key: string;
  minValid: number;
  maxValid: number;
  isCumulative: boolean;
  unitPerCount: number | null;
  isCircular: boolean;
}

export interface EvaluateReadingInput {
  /** Angka apa adanya dari payload device. */
  rawValue: number;
  sensorType: SensorTypeSpec;
  /** Kalibrasi yang berlaku pada device_time, atau null bila tidak ada. */
  calibration: Calibration | null;
  /** Nilai pencacah pada pembacaan sebelumnya; hanya relevan untuk sensor kumulatif. */
  previousCumulativeRaw?: number | null;
  /**
   * Flag yang sudah ditentukan di tingkat payload, bukan per sensor —
   * misalnya FUTURE_TIMESTAMP atau DEVICE_MAINTENANCE. Di-OR dengan flag
   * yang dihasilkan di sini.
   */
  baseFlags?: number;
  /** Batas delta yang masih masuk akal untuk sensor kumulatif, dalam satuan fisik. */
  maxPlausibleDelta?: number | null;
}

export interface EvaluatedReading {
  rawValue: number;
  /** Nilai terkalibrasi; null bila pembacaan bukan hasil pengukuran yang sah. */
  value: number | null;
  /** Selisih untuk sensor kumulatif; null untuk sensor biasa. */
  deltaValue: number | null;
  qualityFlags: number;
  calibrationId: string | null;
}

/**
 * Nilai sentinel yang dipakai firmware untuk menyatakan "sensor ini error",
 * bukan hasil pengukuran. Soal menyebut -999 pada `temp_air`; -9999 ikut
 * disertakan karena lazim dipakai firmware lain dan tidak berada di dalam
 * rentang wajar tipe sensor mana pun di sistem ini.
 *
 * Kenapa daftarnya terpusat di sini dan tidak tersebar sebagai `if (v === -999)`:
 * kalau kelak ada firmware yang memakai sentinel lain, hanya satu tempat ini
 * yang perlu berubah.
 */
export const SENTINEL_ERROR_VALUES: readonly number[] = [-999, -9999];

export function isSentinelError(rawValue: number): boolean {
  return SENTINEL_ERROR_VALUES.includes(rawValue);
}

/**
 * Menilai satu pembacaan.
 *
 * Urutan langkahnya disengaja:
 *
 *  1. **Sentinel dulu.** Angka -999 bukan suhu −999 °C; ia kode error. Kalau
 *     pemeriksaan rentang dijalankan lebih dulu, ia hanya akan ditandai
 *     "di luar rentang" dan alasan sebenarnya hilang. Karena bukan hasil
 *     pengukuran, `value` di-null-kan: nilai null tidak ikut terhitung dalam
 *     rata-rata database, sedangkan -999 yang terlanjur tersimpan sebagai
 *     angka akan menyeret rata-rata suhu ke bawah secara diam-diam.
 *
 *  2. **Kalibrasi**, sebelum pemeriksaan rentang. Rentang wajar tipe sensor
 *     adalah rentang fisik (kelembapan 0–100%), jadi yang dibandingkan
 *     terhadapnya harus nilai yang sudah dikoreksi, bukan angka mentah.
 *
 *  3. **Pemeriksaan rentang.** Pelanggaran hanya DITANDAI. Nilainya tetap
 *     disimpan apa adanya — humidity 150 adalah bukti sensor rusak, dan bukti
 *     itu hilang kalau barisnya dibuang.
 *
 *  4. **Pencacah kumulatif.** Delta dihitung dari nilai MENTAH, bukan dari
 *     nilai terkalibrasi, karena yang dicacah adalah jumlah jungkitan — sebuah
 *     bilangan bulat kejadian, bukan besaran yang perlu dikoreksi.
 */
export function evaluateReading(input: EvaluateReadingInput): EvaluatedReading {
  const { rawValue, sensorType, calibration, baseFlags = 0 } = input;

  let flags = baseFlags;

  // --- Langkah 1: sentinel error ---------------------------------------
  if (isSentinelError(rawValue)) {
    return {
      rawValue,
      value: null,
      // Pencacah yang sedang error tidak boleh menghasilkan delta. Kalau -999
      // diperlakukan sebagai nilai pencacah, pembacaan berikutnya akan dikira
      // lonjakan raksasa dan mencatat hujan ratusan milimeter.
      deltaValue: null,
      qualityFlags: flags | QualityFlag.SENSOR_ERROR,
      calibrationId: null,
    };
  }

  // --- Langkah 2: kalibrasi --------------------------------------------
  const calibrated = applyCalibration(rawValue, calibration);
  if (calibrated.uncalibrated) {
    flags |= QualityFlag.UNCALIBRATED;
  }

  // --- Langkah 3: rentang wajar ----------------------------------------
  if (calibrated.value < sensorType.minValid || calibrated.value > sensorType.maxValid) {
    flags |= QualityFlag.OUT_OF_RANGE;
  }

  // --- Langkah 4: pencacah kumulatif -----------------------------------
  let deltaValue: number | null = null;

  if (sensorType.isCumulative) {
    const delta = computeCumulativeDelta({
      previousRaw: input.previousCumulativeRaw ?? null,
      currentRaw: rawValue,
      // Default 1 berarti "satu cacahan = satu satuan" bila master data lupa
      // diisi — lebih aman daripada mengalikan dengan 0 dan diam-diam
      // melaporkan tidak ada hujan sama sekali.
      unitPerCount: sensorType.unitPerCount ?? 1,
      maxPlausibleDelta: input.maxPlausibleDelta ?? null,
    });

    deltaValue = delta.delta;

    if (delta.counterReset) {
      flags |= QualityFlag.COUNTER_RESET;
    }
    if (delta.implausible) {
      flags |= QualityFlag.OUT_OF_RANGE;
    }
  }

  return {
    rawValue,
    value: calibrated.value,
    deltaValue,
    qualityFlags: flags,
    calibrationId: calibrated.calibrationId,
  };
}

/**
 * Flag yang ditentukan di tingkat payload, bukan per sensor.
 *
 * Dipisahkan dari `evaluateReading` karena berlaku untuk seluruh pembacaan
 * dalam satu payload sekaligus — dihitung sekali, lalu diwariskan ke semua.
 */
export interface TimestampFlagInput {
  deviceTime: Date;
  serverTime: Date;
  /** Selisih yang masih dianggap wajar, dalam detik. Default 300 (5 menit). */
  clockDriftToleranceSeconds: number;
  /**
   * Di atas ambang ini, data dianggap buffered dan ditandai LATE_ARRIVAL.
   * Default 3600 detik.
   */
  lateArrivalThresholdSeconds?: number;
}

export function evaluateTimestampFlags(input: TimestampFlagInput): number {
  const {
    deviceTime,
    serverTime,
    clockDriftToleranceSeconds,
    lateArrivalThresholdSeconds = 3600,
  } = input;

  // Positif berarti device tertinggal (data lama/terlambat).
  // Negatif berarti jam device mendahului server.
  const lagSeconds = (serverTime.getTime() - deviceTime.getTime()) / 1000;

  let flags = QualityFlag.OK;

  if (lagSeconds < -clockDriftToleranceSeconds) {
    // Jam device mendahului server melebihi toleransi. Nilainya tetap
    // disimpan apa adanya; yang dicatat sistem adalah bahwa jamnya tidak bisa
    // dipercaya. Menggeser device_time berarti mengubah data berdasarkan
    // tebakan, dan kalau tebakannya salah kedua versinya hilang.
    flags |= QualityFlag.FUTURE_TIMESTAMP;
  }

  if (lagSeconds > lateArrivalThresholdSeconds) {
    flags |= QualityFlag.LATE_ARRIVAL;
  }

  return flags;
}
