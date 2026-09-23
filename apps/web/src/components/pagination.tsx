'use client';

import type { PaginationMeta } from '@/types';

/**
 * Kaki tabel untuk endpoint list yang dipaginasi.
 *
 * Bentuknya mengikuti `meta.pagination` yang dikirim API apa adanya, sehingga
 * komponen ini bisa dipakai tabel mana pun tanpa penyesuaian: seluruh endpoint
 * list memakai bentuk meta yang sama.
 *
 * Nomor halaman sengaja tidak dirender satu per satu. Pada 175 sensor dengan 20
 * baris per halaman jumlahnya masih kecil, tetapi daftar nomor halaman akan
 * tumbuh sejalan dengan data dan pada akhirnya justru menyulitkan — sementara
 * "halaman berapa dari berapa" sudah menjawab pertanyaan yang sebenarnya.
 */
export function Pagination({
  meta,
  onChange,
  label,
}: {
  meta: PaginationMeta;
  onChange: (page: number) => void;
  label: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-3 text-xs text-slate-600">
      <span>
        Halaman {meta.page} dari {meta.total_pages} · {meta.total} {label}
      </span>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onChange(Math.max(1, meta.page - 1))}
          disabled={meta.page <= 1}
          className="rounded-md border border-slate-300 px-2 py-1 disabled:opacity-40"
        >
          Sebelumnya
        </button>
        <button
          type="button"
          onClick={() => onChange(meta.page + 1)}
          disabled={meta.page >= meta.total_pages}
          className="rounded-md border border-slate-300 px-2 py-1 disabled:opacity-40"
        >
          Berikutnya
        </button>
      </div>
    </div>
  );
}
