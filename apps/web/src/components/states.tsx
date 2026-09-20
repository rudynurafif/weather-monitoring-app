'use client';

import type { ApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

/**
 * Tiga keadaan yang dinilai di soal: memuat, kosong, dan gagal.
 * Dibuat sebagai komponen bersama supaya bentuknya seragam di semua halaman.
 */

export function LoadingState({ label = 'Memuat data...' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-slate-200 bg-white px-6 py-12">
      {/* Spinner ditandai aria-hidden karena label teks di bawahnya sudah
          menyampaikan informasi yang sama kepada pembaca layar. */}
      <div
        aria-hidden
        className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-slate-600"
      />
      <p className="text-sm text-slate-500">{label}</p>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {description && <p className="max-w-md text-sm text-slate-500">{description}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-6 py-8">
      <p className="text-sm font-semibold text-red-900">Gagal memuat data</p>
      <p className="mt-1 text-sm text-red-800">{error.message}</p>

      {/* Kode error dan request_id ditampilkan apa adanya: keduanya yang
          membuat satu keluhan pengguna bisa ditelusuri ke satu baris log. */}
      <dl className="mt-3 space-y-1 text-xs text-red-700">
        <div className="flex gap-2">
          <dt className="font-medium">Kode</dt>
          <dd className="font-mono">{error.code}</dd>
        </div>
        {error.requestId && (
          <div className="flex gap-2">
            <dt className="font-medium">Request ID</dt>
            <dd className="font-mono">{error.requestId}</dd>
          </div>
        )}
      </dl>

      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
        >
          Coba lagi
        </button>
      )}
    </div>
  );
}

/**
 * Penanda "data terakhir diperbarui" beserta tombol refresh manual.
 *
 * Polling berjalan sendiri, tetapi tombolnya tetap ada karena orang yang
 * sedang memeriksa sesuatu ingin memastikan angkanya benar-benar baru, bukan
 * menunggu siklus berikutnya.
 */
export function RefreshBar({
  lastUpdatedAt,
  isRefreshing,
  onRefresh,
  intervalSeconds,
}: {
  lastUpdatedAt: Date | null;
  isRefreshing: boolean;
  onRefresh: () => void;
  intervalSeconds?: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
      <span>
        Diperbarui {lastUpdatedAt ? formatDateTime(lastUpdatedAt.toISOString()) : '—'}
        {intervalSeconds ? ` · otomatis tiap ${intervalSeconds} detik` : ''}
      </span>
      <button
        type="button"
        onClick={onRefresh}
        disabled={isRefreshing}
        className="rounded-md border border-slate-300 bg-white px-2 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        {isRefreshing ? 'Memuat...' : 'Perbarui'}
      </button>
    </div>
  );
}
