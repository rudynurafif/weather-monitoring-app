/**
 * Bentuk amplop response dan pagination — dipakai seluruh endpoint.
 *
 * Ditaruh di sini, bukan di `lib/api.ts`, supaya berkas itu berisi perilaku
 * (fetch, penguraian error) sementara bentuk datanya terkumpul di satu tempat
 * bersama tipe domain lainnya.
 */

export interface ApiMeta {
  request_id: string;
  timestamp: string;
  [key: string]: unknown;
}

export interface ApiResult<T> {
  data: T;
  meta: ApiMeta;
}

/** Isi `meta.pagination` pada setiap endpoint list. */
export interface PaginationMeta {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
}

/**
 * Hasil endpoint list setelah amplopnya dibongkar.
 *
 * API mengirim baris di `data` dan pagination di `meta`; komponen tabel lebih
 * mudah dipakai kalau keduanya sudah menyatu dalam satu objek.
 */
export interface Paginated<T> {
  rows: T[];
  pagination: PaginationMeta;
}
