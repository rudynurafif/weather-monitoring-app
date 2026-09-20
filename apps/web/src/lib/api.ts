/**
 * Pembungkus pemanggilan API.
 *
 * Seluruh backend memakai envelope `{ success, data, meta }` atau
 * `{ success, error, meta }`. Pembongkarannya dikerjakan di satu tempat ini,
 * sehingga komponen hanya berurusan dengan data dan tidak pernah menyentuh
 * bentuk envelope-nya.
 */

const BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001').replace(
  /\/$/,
  '',
);

export interface ApiMeta {
  request_id: string;
  timestamp: string;
  [key: string]: unknown;
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiResult<T> {
  data: T;
  meta: ApiMeta;
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit & { query?: Record<string, string | number | undefined> },
): Promise<ApiResult<T>> {
  const url = new URL(`${BASE_URL}/api/v1${path}`);

  for (const [key, value] of Object.entries(init?.query ?? {})) {
    if (value !== undefined && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  let response: Response;

  try {
    response = await fetch(url.toString(), {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      cache: 'no-store',
    });
  } catch {
    // Jaringan putus atau API tidak hidup. Dibedakan dari error HTTP supaya
    // pesannya bisa menyebut penyebab yang benar.
    throw new ApiError(
      'NETWORK_ERROR',
      'Tidak bisa menghubungi API. Pastikan backend sedang berjalan.',
      0,
    );
  }

  const body = (await response.json().catch(() => null)) as
    | { success: boolean; data?: T; meta?: ApiMeta; error?: { code: string; message: string } }
    | null;

  if (!response.ok || !body?.success) {
    throw new ApiError(
      body?.error?.code ?? 'UNKNOWN_ERROR',
      body?.error?.message ?? `Permintaan gagal (HTTP ${response.status})`,
      response.status,
      body?.meta?.request_id,
    );
  }

  return { data: body.data as T, meta: body.meta as ApiMeta };
}

// ---------------------------------------------------------------------------
// Bentuk data dari API
// ---------------------------------------------------------------------------

export interface DeviceOverview {
  id: string;
  device_code: string;
  name: string;
  status: string;
  location: { name: string; latitude: number; longitude: number; altitude_m: number } | null;
  last_seen_at: string | null;
  silent_minutes: number | null;
  connectivity: 'ONLINE' | 'SILENT' | 'OFFLINE' | 'NEVER_SEEN';
  battery_v: number | null;
  rssi: number | null;
  latest: { temp_air: number | null; humidity: number | null; rain_today_mm: number };
}

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
 * Mengubah response kolom terpisah menjadi daftar objek.
 *
 * Kebalikan dari keputusan efisiensi di server: kawat membawa bentuk kolom
 * yang ringkas, sedangkan Recharts membutuhkan array of object. Konversinya
 * terjadi sekali di sini.
 */
export function pointsToRows(response: SeriesResponse): Array<Record<string, unknown>> {
  return response.points.map((point) => {
    const row: Record<string, unknown> = {};
    response.columns.forEach((column, index) => {
      row[column] = point[index];
    });
    return row;
  });
}
