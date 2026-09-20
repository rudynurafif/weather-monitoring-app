/**
 * Penerapan kalibrasi sensor.
 *
 * Aturan tunggalnya (ketentuan B.3):
 *
 *     nilai_terkoreksi = nilai_mentah * scale + offset
 *
 * Urutannya penting dan bukan selera: `scale` mengoreksi kesalahan yang
 * sebanding dengan besaran yang diukur (sensitivitas sensor melenceng),
 * sedangkan `offset` mengoreksi pergeseran tetap (titik nol melenceng).
 * Mengalikan dulu baru menambah berarti offset tidak ikut diperbesar oleh
 * scale — dan itulah perilaku yang benar secara fisika.
 *
 * Nilai mentah TIDAK PERNAH diubah. Fungsi ini menghasilkan nilai baru yang
 * disimpan di kolom terpisah, sehingga kalibrasi apa pun bisa dihitung ulang
 * atau dibatalkan selama `raw_value` masih ada.
 */

export interface Calibration {
  id: string;
  offset: number;
  scale: number;
}

/**
 * Kalibrasi lengkap dengan masa berlakunya, sebagaimana tersimpan di database.
 *
 * Dipisahkan dari `Calibration` supaya `applyCalibration` hanya bergantung
 * pada angka koreksinya saja - fungsi itu tidak perlu tahu apa pun tentang
 * waktu, dan karenanya jauh lebih mudah diuji.
 */
export interface EffectiveCalibration extends Calibration {
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

export interface CalibrationResult {
  /** Nilai setelah koreksi. */
  value: number;
  /** Kalibrasi yang dipakai; `null` bila tidak ada yang berlaku. */
  calibrationId: string | null;
  /** Benar bila tidak ada kalibrasi yang berlaku dan nilai mentah dipakai apa adanya. */
  uncalibrated: boolean;
}

/**
 * Menerapkan kalibrasi pada satu nilai mentah.
 *
 * Bila `calibration` null — sensor belum pernah dikalibrasi, atau pembacaan ini
 * berasal dari waktu sebelum kalibrasi pertama dibuat — nilai mentah dipakai
 * apa adanya dan ditandai `uncalibrated`. Yang sengaja TIDAK dilakukan adalah
 * membuang pembacaannya: data tanpa koreksi tetap jauh lebih berguna daripada
 * tidak ada data, asalkan statusnya jujur tercatat.
 */
export function applyCalibration(
  rawValue: number,
  calibration: Calibration | null,
): CalibrationResult {
  if (calibration === null) {
    return { value: rawValue, calibrationId: null, uncalibrated: true };
  }

  return {
    value: rawValue * calibration.scale + calibration.offset,
    calibrationId: calibration.id,
    uncalibrated: false,
  };
}

/**
 * Memilih kalibrasi yang berlaku pada sebuah titik waktu.
 *
 * Yang dipakai sebagai pembanding adalah `device_time` — waktu pengukuran —
 * BUKAN waktu sekarang. Inilah yang membuat data buffered dari tiga jam lalu
 * tetap memperoleh koreksi yang memang berlaku saat itu, walaupun kalibrasinya
 * sudah diganti sebelum data tersebut sampai ke server.
 *
 * Rentangnya setengah terbuka: `effective_from <= t < effective_to`. Batas
 * seperti ini membuat kalibrasi yang berurutan tidak pernah berebut satu titik
 * waktu — yang lama berakhir tepat di detik yang baru dimulai. `effective_to`
 * bernilai null berarti berlaku sampai tak berhingga.
 *
 * Daftar masukan diasumsikan sudah dijamin tidak tumpang tindih oleh exclusion
 * constraint `sensor_calibration_no_overlap` di database, sehingga paling
 * banyak hanya ada satu yang cocok. Fungsi ini tetap mengembalikan yang
 * pertama cocok, bukan melempar error, agar jalur ingestion tidak berhenti
 * hanya karena data master yang aneh.
 */
export function findEffectiveCalibration<
  T extends { effectiveFrom: Date; effectiveTo: Date | null },
>(calibrations: readonly T[], at: Date): T | null {
  const t = at.getTime();

  return (
    calibrations.find((c) => {
      const from = c.effectiveFrom.getTime();
      const to = c.effectiveTo === null ? Number.POSITIVE_INFINITY : c.effectiveTo.getTime();
      return from <= t && t < to;
    }) ?? null
  );
}
