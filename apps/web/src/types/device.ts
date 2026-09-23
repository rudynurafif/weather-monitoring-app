/** Device (stasiun cuaca) beserta turunannya. */

import type { DeviceLocation } from './location';

/**
 * Empat status siklus hidup device.
 *
 * Dijaga sebagai union, bukan `string`, supaya salah ketik tertangkap saat
 * kompilasi. Urutan transisi yang diizinkan ditegakkan backend.
 */
export type DeviceStatus = 'PROVISIONED' | 'ACTIVE' | 'MAINTENANCE' | 'DECOMMISSIONED';

/** Keadaan sambungan, dihitung server dari selisih waktu pembacaan terakhir. */
export type Connectivity = 'ONLINE' | 'SILENT' | 'OFFLINE' | 'NEVER_SEEN';

/** Bentuk device pada dashboard ikhtisar. */
export interface DeviceOverview {
  id: string;
  device_code: string;
  name: string;
  status: string;
  location: Omit<DeviceLocation, 'id'> | null;
  last_seen_at: string | null;
  silent_minutes: number | null;
  connectivity: Connectivity;
  battery_v: number | null;
  rssi: number | null;
  latest: { temp_air: number | null; humidity: number | null; rain_today_mm: number };
}

/** Bentuk device pada halaman detail: menambah riwayat status dan sensor terpasang. */
export interface DeviceDetail extends DeviceOverview {
  firmware_version: string | null;
  status_history: Array<{
    from_status: string | null;
    to_status: string;
    reason: string | null;
    changed_at: string;
  }>;
  sensors: Array<{
    installation_id: string;
    sensor_id: string;
    serial_number: string;
    sensor_type: string;
    unit: string;
    channel: number;
    installed_at: string;
  }>;
}

/**
 * Baris pada tabel manajemen device.
 *
 * Membawa `location.id` dan `firmware_version` karena form ubah mengisi
 * nilainya dari baris tabel, tanpa permintaan detail terpisah.
 */
export interface DeviceListItem {
  id: string;
  device_code: string;
  name: string;
  status: string;
  firmware_version: string | null;
  location: Pick<DeviceLocation, 'id' | 'name'> | null;
  last_seen_at: string | null;
}

/**
 * Hasil rotasi kredensial.
 *
 * `device_key` hanya pernah muncul sekali, pada response ini. Yang tersimpan di
 * database hanya hash-nya.
 */
export interface RotatedCredential {
  key_id: string;
  device_key: string;
  previous_credentials_valid_until: string;
}

/** Device yang baru dibuat, beserta kredensial pertamanya. */
export interface CreatedDevice extends DeviceDetail {
  credential: { device_key: string };
}
