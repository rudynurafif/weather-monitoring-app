/**
 * Quality flag pembacaan sensor, disimpan sebagai BITMASK di kolom
 * `sensor_reading.quality_flags`.
 *
 * Kenapa bitmask, bukan satu kolom enum: satu pembacaan bisa bermasalah lebih
 * dari satu cara sekaligus. Nilai humidity 150 yang datang dari payload dengan
 * timestamp di masa depan adalah dua masalah berbeda, dan keduanya perlu
 * terekam. Dengan enum tunggal kita harus memilih salah satu dan membuang
 * informasi yang lain.
 *
 * Kenapa ditandai, bukan dibuang (ketentuan B.4): nilai di luar rentang adalah
 * FAKTA LAPANGAN. Sensor yang membaca 150% kelembapan memberi tahu kita bahwa
 * sensornya rusak — informasi yang justru hilang kalau baris itu tidak
 * disimpan. Yang dilakukan sistem adalah menyimpannya sambil menandai agar
 * tidak ikut mencemari rata-rata.
 */
export const QualityFlag = {
  /** Tidak ada masalah yang terdeteksi. */
  OK: 0,

  /** Nilai di luar [min_valid, max_valid] tipe sensor. Contoh: humidity 150. */
  OUT_OF_RANGE: 1 << 0, // 1

  /** Device mengirim sentinel error, bukan hasil pengukuran. Contoh: temp_air -999. */
  SENSOR_ERROR: 1 << 1, // 2

  /** device_time lebih maju dari server_time melampaui toleransi clock drift. */
  FUTURE_TIMESTAMP: 1 << 2, // 4

  /** Data buffered yang tiba jauh setelah waktu pengukurannya. */
  LATE_ARRIVAL: 1 << 3, // 8

  /** Pencacah kumulatif turun dibanding pembacaan sebelumnya: device restart. */
  COUNTER_RESET: 1 << 4, // 16

  /** Tidak ada sensor terpasang pada slot ini saat device_time. */
  NO_INSTALLATION: 1 << 5, // 32

  /** Tidak ada kalibrasi yang berlaku; nilai dipakai apa adanya (scale 1, offset 0). */
  UNCALIBRATED: 1 << 6, // 64

  /** Device sedang berstatus MAINTENANCE saat data ini masuk. */
  DEVICE_MAINTENANCE: 1 << 7, // 128

  /** Nilai identik terus-menerus dalam jangka panjang: sensor diduga macet. */
  STUCK_SENSOR: 1 << 8, // 256
} as const;

export type QualityFlagName = keyof typeof QualityFlag;

/**
 * Flag yang membuat sebuah pembacaan TIDAK boleh ikut dihitung dalam agregat
 * statistik (rata-rata, min, maks).
 *
 * Perhatikan LATE_ARRIVAL dan COUNTER_RESET sengaja TIDAK masuk daftar ini:
 * data yang terlambat nilainya tetap sah, dan pembacaan saat counter reset
 * tetap mewakili hujan yang benar-benar turun.
 */
export const UNUSABLE_FLAGS =
  QualityFlag.SENSOR_ERROR | QualityFlag.OUT_OF_RANGE | QualityFlag.NO_INSTALLATION;

/** Apakah pembacaan dengan flag ini layak masuk perhitungan statistik. */
export function isUsable(flags: number): boolean {
  return (flags & UNUSABLE_FLAGS) === 0;
}

/** Apakah satu flag tertentu menyala. */
export function hasFlag(flags: number, flag: number): boolean {
  return (flags & flag) !== 0;
}

/**
 * Menerjemahkan bitmask menjadi daftar nama, untuk response API dan UI.
 * Klien tidak seharusnya menghitung bit sendiri — biarkan server yang
 * menjelaskan artinya.
 */
export function describeFlags(flags: number): QualityFlagName[] {
  if (flags === QualityFlag.OK) {
    return [];
  }

  return (Object.keys(QualityFlag) as QualityFlagName[]).filter(
    (name) => QualityFlag[name] !== 0 && (flags & QualityFlag[name]) !== 0,
  );
}
