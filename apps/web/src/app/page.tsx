'use client';

import Link from 'next/link';
import { apiFetch, type DeviceOverview } from '@/lib/api';
import { connectivityStyle, formatDateTime, formatNumber, relativeMinutes } from '@/lib/format';
import { useApi } from '@/lib/use-api';
import { EmptyState, ErrorState, LoadingState, RefreshBar } from '@/components/states';

const REFRESH_SECONDS = 30;

/**
 * Halaman ikhtisar: satu kartu per stasiun.
 *
 * Seluruh isinya datang dari SATU permintaan ke /dashboard/overview, bukan
 * satu permintaan per device. Status online/offline pun sudah diturunkan di
 * server, sehingga tidak bergantung pada jam perangkat pengguna yang bisa saja
 * meleset.
 */
export default function OverviewPage() {
  const { data, error, isLoading, isRefreshing, lastUpdatedAt, refresh } = useApi<DeviceOverview[]>(
    async () => (await apiFetch<DeviceOverview[]>('/dashboard/overview')).data,
    [],
    { refreshIntervalMs: REFRESH_SECONDS * 1000 },
  );

  const silentCount = data?.filter((device) => device.connectivity !== 'ONLINE').length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Ikhtisar Stasiun</h1>
          <p className="text-sm text-slate-500">
            {data ? `${data.length} stasiun terdaftar` : 'Memuat...'}
            {silentCount > 0 && (
              <span className="ml-1 font-medium text-amber-700">
                · {silentCount} perlu diperiksa
              </span>
            )}
          </p>
        </div>
        <RefreshBar
          lastUpdatedAt={lastUpdatedAt}
          isRefreshing={isRefreshing}
          onRefresh={refresh}
          intervalSeconds={REFRESH_SECONDS}
        />
      </div>

      {isLoading && <LoadingState label="Memuat daftar stasiun..." />}

      {/* Error hanya menggantikan seluruh layar bila memang belum ada data
          sama sekali. Kalau data lama masih ada, ia tetap ditampilkan dan
          kegagalannya cukup muncul sebagai pita peringatan di atas. */}
      {error && !data && <ErrorState error={error} onRetry={refresh} />}

      {error && data && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Pembaruan terakhir gagal ({error.code}). Angka di bawah mungkin sudah tidak terbaru.
        </div>
      )}

      {data && data.length === 0 && (
        <EmptyState
          title="Belum ada stasiun terdaftar"
          description="Daftarkan stasiun lewat halaman Manajemen, atau jalankan seeder untuk memuat data contoh."
        />
      )}

      {data && data.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((device) => (
            <DeviceCard key={device.id} device={device} />
          ))}
        </div>
      )}
    </div>
  );
}

function DeviceCard({ device }: { device: DeviceOverview }) {
  const status = connectivityStyle(device.connectivity);

  // Ambang 15 menit diminta eksplisit di soal. Nilainya ikut ditampilkan
  // sebagai peringatan tersendiri, bukan hanya sebagai warna lencana.
  const needsAttention = device.silent_minutes !== null && device.silent_minutes >= 15;

  return (
    <Link
      href={`/devices/${device.id}`}
      className="block rounded-lg border border-slate-200 bg-white p-4 transition hover:border-slate-300 hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">{device.name}</p>
          <p className="truncate text-xs text-slate-500">
            {device.device_code}
            {device.location ? ` · ${device.location.name}` : ''}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${status.className}`}
        >
          {status.label}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Metric label="Suhu" value={formatNumber(device.latest.temp_air, 1)} unit="°C" />
        <Metric label="Kelembapan" value={formatNumber(device.latest.humidity, 1)} unit="%" />
        <Metric label="Hujan hari ini" value={formatNumber(device.latest.rain_today_mm, 1)} unit="mm" />
      </div>

      <div className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
        <p>
          Update terakhir: {relativeMinutes(device.silent_minutes)}
          {device.last_seen_at && (
            <span className="ml-1 text-slate-400">({formatDateTime(device.last_seen_at)})</span>
          )}
        </p>
        {needsAttention && (
          <p className="mt-1 font-medium text-amber-700">
            Tidak mengirim data lebih dari 15 menit
          </p>
        )}
        {device.battery_v !== null && (
          <p className="mt-1 text-slate-400">
            Baterai {formatNumber(device.battery_v, 2)} V
            {device.rssi !== null && ` · sinyal ${device.rssi} dBm`}
          </p>
        )}
      </div>
    </Link>
  );
}

function Metric({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-lg font-semibold text-slate-900">
        {value}
        <span className="ml-0.5 text-xs font-normal text-slate-500">{unit}</span>
      </p>
    </div>
  );
}
