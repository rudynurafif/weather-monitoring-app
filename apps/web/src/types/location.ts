/**
 * Lokasi pemasangan stasiun.
 *
 * Dipisahkan dari device karena keduanya berumur berbeda: perangkat bisa rusak
 * dan diganti, sementara lokasinya tetap.
 */

export interface Location {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  altitude_m: number;
  description?: string | null;
}

/** Baris pada daftar lokasi; `device_count` hanya menghitung device yang masih hidup. */
export interface LocationOption extends Location {
  device_count: number;
}

/** Lokasi seperti yang menempel pada objek device. */
export type DeviceLocation = Pick<
  Location,
  'id' | 'name' | 'latitude' | 'longitude' | 'altitude_m'
>;
