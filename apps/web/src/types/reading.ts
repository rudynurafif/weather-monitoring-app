/** Pembacaan sensor dan turunannya. */

export interface LatestReading {
  sensor_type: string;
  display_name: string;
  unit: string;
  channel: number;
  device_time: string;
  value: number | null;
  raw_value: number;
  delta_value: number | null;
  quality_flags: string[];
}

/**
 * Response time-series.
 *
 * Titik dikirim sebagai array kolom terpisah, bukan array of object: nama
 * field tidak diulang untuk setiap titik, sehingga payload jauh lebih ringkas
 * pada rentang panjang. Pengubahannya ke bentuk objek dilakukan sekali di
 * `pointsToRows`.
 */
export interface SeriesResponse {
  series: {
    device_id: string;
    sensor_type: string;
    unit: string;
    precision: number;
    interval: string;
    agg: string | null;
    from: string;
    to: string;
    point_count: number;
  };
  columns: string[];
  points: unknown[][];
}

export interface DailySummary {
  date: string;
  temp_min: number | null;
  temp_max: number | null;
  temp_avg: number | null;
  humidity_avg: number | null;
  rain_mm: number;
  wind_max: number | null;
  reading_count: number;
}
