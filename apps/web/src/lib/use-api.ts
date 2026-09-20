'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './api';

/**
 * Hook pengambil data dengan tiga keadaan eksplisit: memuat, gagal, dan
 * kosong. Ketiganya dinilai di soal, jadi dibuat mustahil untuk dilupakan —
 * komponen menerimanya sebagai nilai, bukan sebagai sesuatu yang perlu
 * diingat-ingat sendiri.
 *
 * Juga menyediakan polling opsional dan penanda "terakhir diperbarui".
 */
export interface UseApiState<T> {
  data: T | null;
  error: ApiError | null;
  isLoading: boolean;
  /** True saat memuat ulang, sementara data lama masih ditampilkan. */
  isRefreshing: boolean;
  lastUpdatedAt: Date | null;
  refresh: () => void;
}

export function useApi<T>(
  fetcher: () => Promise<T>,
  deps: unknown[],
  options: { refreshIntervalMs?: number; enabled?: boolean } = {},
): UseApiState<T> {
  const { refreshIntervalMs, enabled = true } = options;

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [isLoading, setIsLoading] = useState(enabled);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);

  // Fetcher disimpan di ref supaya perubahan identitas fungsinya tidak memicu
  // pengambilan ulang — yang menentukan hanyalah deps yang diberikan pemanggil.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const load = useCallback(
    async (isBackground: boolean) => {
      if (!enabled) return;

      if (isBackground) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }

      try {
        const result = await fetcherRef.current();
        setData(result);
        setError(null);
        setLastUpdatedAt(new Date());
      } catch (caught) {
        // Saat polling gagal, data lama SENGAJA dipertahankan. Mengosongkan
        // layar hanya karena satu permintaan latar gagal membuat dashboard
        // berkedip tanpa alasan yang berguna bagi penggunanya.
        setError(
          caught instanceof ApiError
            ? caught
            : new ApiError('UNKNOWN_ERROR', 'Terjadi kesalahan tak terduga', 0),
        );
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [enabled],
  );

  useEffect(() => {
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    if (!refreshIntervalMs || !enabled) return;

    const timer = setInterval(() => void load(true), refreshIntervalMs);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshIntervalMs, enabled, ...deps]);

  return {
    data,
    error,
    isLoading,
    isRefreshing,
    lastUpdatedAt,
    refresh: () => void load(true),
  };
}
