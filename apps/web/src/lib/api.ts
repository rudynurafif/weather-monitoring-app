/**
 * Pembungkus pemanggilan API.
 *
 * Seluruh backend memakai envelope `{ success, data, meta }` atau
 * `{ success, error, meta }`. Pembongkarannya dikerjakan di satu tempat ini,
 * sehingga komponen hanya berurusan dengan data dan tidak pernah menyentuh
 * bentuk envelope-nya.
 */

import type { ApiMeta, ApiResult, SeriesResponse } from '@/types';

const BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001').replace(
  /\/$/,
  '',
);

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
