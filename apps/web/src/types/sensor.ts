/** Tipe sensor (master data), sensor fisik, pemasangan, dan kalibrasi. */

/**
 * Master data tipe sensor.
 *
 * `min_valid`/`max_valid` bukan penyaring: pembacaan di luar rentang tetap
 * disimpan dan hanya ditandai `OUT_OF_RANGE`. `is_cumulative` dan `is_circular`
 * mengubah cara nilainya diperlakukan — yang pertama dihitung sebagai selisih,
 * yang kedua dirata-ratakan secara vektor.
 */
export interface SensorTypeItem {
  key: string;
  display_name: string;
  unit: string;
  min_valid: number;
  max_valid: number;
  precision: number;
  is_cumulative: boolean;
  unit_per_count: number | null;
  is_circular: boolean;
}

/** Sensor fisik. Identitasnya adalah nomor seri, yang bertahan meski berpindah device. */
export interface SensorListItem {
  id: string;
  serial_number: string;
  sensor_type: string;
  status: string;
  installed_on: { device_id: string; device_code: string; channel: number } | null;
}

/**
 * Satu baris riwayat pemasangan.
 *
 * `removed_at` bernilai null berarti masih terpasang. Memindahkan sensor
 * menutup baris lama dan membuka baris baru — tidak ada baris yang ditimpa,
 * sehingga pembacaan lama tetap terhubung ke device tempat sensornya berada
 * saat itu.
 */
export interface InstallationHistoryItem {
  id: string;
  device_code: string;
  device_name: string;
  channel: number;
  installed_at: string;
  removed_at: string | null;
  is_current: boolean;
  notes: string | null;
}

/**
 * Satu baris riwayat kalibrasi.
 *
 * Koreksi diterapkan sebagai `nilai = mentah × scale + offset`, dan hanya
 * berlaku untuk pembacaan di dalam rentang waktunya. Rentangnya tidak pernah
 * tumpang tindih.
 */
export interface CalibrationItem {
  id: string;
  offset: number;
  scale: number;
  effective_from: string;
  effective_to: string | null;
  is_current: boolean;
  notes: string | null;
}
