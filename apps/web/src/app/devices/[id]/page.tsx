'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import {
  apiFetch,
  pointsToRows,
  type DeviceDetail,
  type LatestReading,
  type SeriesResponse,
} from '@/lib/api';
import { connectivityStyle, formatDateTime, formatNumber, relativeMinutes } from '@/lib/format';
import { useApi } from '@/lib/use-api';
import { EmptyState, ErrorState, LoadingState, RefreshBar } from '@/components/states';
import { RainChart, TempHumidityChart, WindRose, type SeriesPoint } from '@/components/charts';

const REFRESH_SECONDS = 30;

/**
 * Pilihan rentang waktu.
 *
 * `interval` yang diminta sengaja SUDAH disesuaikan dengan lebar rentangnya —
 * soal melarang menarik data mentah 30 hari lalu mengagregasinya di browser.
 * Server tetap punya kebijakan sendiri dan berhak menaikkan resolusi lagi;
 * yang benar-benar dipakai dilaporkan kembali lewat meta.
 */
const RANGES = [
  { key: '24h', label: '24 jam', hours: 24, interval: 'raw', rainInterval: '1h', rainGranularity: 'jam' },
  { key: '7d', label: '7 hari', hours: 24 * 7, interval: '1h', rainInterval: '1h', rainGranularity: 'jam' },
  { key: '30d', label: '30 hari', hours: 24 * 30, interval: '1h', rainInterval: '1d', rainGranularity: 'hari' },
] as const;

type RangeKey = (typeof RANGES)[number]['key'];

interface ChartBundle {
  temperature: SeriesPoint[];
  humidity: SeriesPoint[];
  rain: SeriesPoint[];
  windDir: SeriesPoint[];
  windSpeed: SeriesPoint[];
  intervalApplied: string;
  intervalCoarsened: boolean;
  pointCount: number;
}

export default function DeviceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [rangeKey, setRangeKey] = useState<RangeKey>('24h');
  const range = RANGES.find((item) => item.key === rangeKey)!;

  const device = useApi<DeviceDetail>(
    async () => (await apiFetch<DeviceDetail>(`/devices/${id}`)).data,
    [id],
    { refreshIntervalMs: REFRESH_SECONDS * 1000 },
  );

  const latest = useApi<LatestReading[]>(
    async () => (await apiFetch<LatestReading[]>(`/devices/${id}/readings/latest`)).data,
    [id],
    { refreshIntervalMs: REFRESH_SECONDS * 1000 },
  );

  const charts = useApi<ChartBundle>(
    async () => {
      const to = new Date();
      const from = new Date(to.getTime() - range.hours * 3_600_000);

      const load = async (sensorType: string, interval: string) => {
        const result = await apiFetch<SeriesResponse>('/readings', {
          query: {
            device_id: id,
            sensor_type: sensorType,
            from: from.toISOString(),
            to: to.toISOString(),
            interval,
            agg: 'avg',
          },
        });

        return {
          points: pointsToRows(result.data).map((row) => ({
            t: String(row.t),
            v: (row.v as number | null) ?? null,
          })),
          meta: result.meta,
          series: result.data.series,
        };
      };

      // Lima deret diminta bersamaan, bukan berurutan: waktu tunggunya menjadi
      // selama permintaan terlama, bukan jumlah kelimanya.
      const [temperature, humidity, rain, windDir, windSpeed] = await Promise.all([
        load('temp_air', range.interval),
        load('humidity', range.interval),
        load('rain_counter', range.rainInterval),
        load('wind_dir', range.interval),
        load('wind_speed', range.interval),
      ]);

      return {
        temperature: temperature.points,
        humidity: humidity.points,
        rain: rain.points,
        windDir: windDir.points,
        windSpeed: windSpeed.points,
        intervalApplied: String(temperature.series.interval),
        intervalCoarsened: Boolean(temperature.meta.interval_coarsened),
        pointCount: temperature.points.length,
      };
    },
    [id, rangeKey],
    { refreshIntervalMs: REFRESH_SECONDS * 1000 },
  );

  const status = device.data ? connectivityStyle(device.data.connectivity) : null;

  // Jarak antar titik yang diharapkan, dipakai untuk mendeteksi lubang data.
  const intervalMs =
    charts.data?.intervalApplied === '1d'
      ? 86_400_000
      : charts.data?.intervalApplied === '1h'
        ? 3_600_000
        : 300_000; // data contoh dibuat per 5 menit

  return (
    <div className="space-y-4">
      <Link href="/" className="text-sm text-slate-500 hover:text-slate-800">
        ← Kembali ke ikhtisar
      </Link>

      {device.isLoading && <LoadingState label="Memuat detail stasiun..." />}
      {device.error && !device.data && <ErrorState error={device.error} onRetry={device.refresh} />}

      {device.data && (
        <>
          <header className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-semibold text-slate-900">{device.data.name}</h1>
                {status && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${status.className}`}
                  >
                    {status.label}
                  </span>
                )}
              </div>
              <p className="text-sm text-slate-500">
                {device.data.device_code}
                {device.data.location &&
                  ` · ${device.data.location.name} · ${device.data.location.altitude_m} mdpl`}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Data terakhir {relativeMinutes(device.data.silent_minutes)} (
                {formatDateTime(device.data.last_seen_at)})
              </p>
            </div>

            <RefreshBar
              lastUpdatedAt={device.lastUpdatedAt}
              isRefreshing={device.isRefreshing || charts.isRefreshing}
              onRefresh={() => {
                device.refresh();
                latest.refresh();
                charts.refresh();
              }}
              intervalSeconds={REFRESH_SECONDS}
            />
          </header>

          {/* --- Nilai terkini seluruh sensor --- */}
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Nilai Terkini</h2>

            {latest.isLoading && <LoadingState label="Memuat pembacaan..." />}
            {latest.error && !latest.data && (
              <ErrorState error={latest.error} onRetry={latest.refresh} />
            )}
            {latest.data && latest.data.length === 0 && (
              <EmptyState
                title="Belum ada pembacaan"
                description="Stasiun ini belum pernah mengirim data sensor. Jalankan device simulator untuk mengisinya."
              />
            )}

            {latest.data && latest.data.length > 0 && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {latest.data.map((reading) => (
                  <div
                    key={`${reading.sensor_type}-${reading.channel}`}
                    className="rounded-md border border-slate-100 bg-slate-50 p-3"
                  >
                    <p className="truncate text-xs text-slate-500">{reading.display_name}</p>
                    <p className="text-lg font-semibold text-slate-900">
                      {/* Untuk sensor kumulatif, yang bermakna adalah selisihnya
                          (mm hujan pada interval terakhir), bukan nilai pencacah. */}
                      {reading.sensor_type === 'rain_counter'
                        ? formatNumber(reading.delta_value, 1)
                        : formatNumber(reading.value, 1)}
                      <span className="ml-1 text-xs font-normal text-slate-500">
                        {reading.unit}
                      </span>
                    </p>
                    {reading.quality_flags.length > 0 && (
                      <p className="mt-1 text-xs font-medium text-amber-700">
                        {reading.quality_flags.join(', ')}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-slate-400">
                      {formatDateTime(reading.device_time)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* --- Pemilih rentang --- */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5">
              {RANGES.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setRangeKey(item.key)}
                  className={`rounded px-3 py-1 text-sm font-medium transition ${
                    item.key === rangeKey
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {charts.data && (
              <p className="text-xs text-slate-500">
                Resolusi {charts.data.intervalApplied} · {charts.data.pointCount} titik
                {charts.data.intervalCoarsened && (
                  <span className="ml-1 text-amber-700">
                    (dinaikkan otomatis oleh server agar response tetap ringan)
                  </span>
                )}
              </p>
            )}
          </div>

          {/* --- Chart --- */}
          {charts.isLoading && <LoadingState label="Memuat grafik..." />}
          {charts.error && !charts.data && (
            <ErrorState error={charts.error} onRetry={charts.refresh} />
          )}

          {charts.data && charts.data.temperature.length === 0 && (
            <EmptyState
              title="Tidak ada data pada rentang ini"
              description="Coba pilih rentang yang lebih panjang, atau jalankan device simulator."
            />
          )}

          {charts.data && charts.data.temperature.length > 0 && (
            <div className="space-y-4">
              <TempHumidityChart
                temperature={charts.data.temperature}
                humidity={charts.data.humidity}
                rangeHours={range.hours}
                intervalMs={intervalMs}
              />

              <div className="grid gap-4 lg:grid-cols-2">
                <RainChart
                  points={charts.data.rain}
                  rangeHours={range.hours}
                  granularity={range.rainGranularity}
                />
                <WindRose directions={charts.data.windDir} speeds={charts.data.windSpeed} />
              </div>
            </div>
          )}

          {/* --- Sensor terpasang & riwayat status --- */}
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">Sensor Terpasang</h2>
              {device.data.sensors.length === 0 ? (
                <p className="text-sm text-slate-500">Belum ada sensor terpasang.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs uppercase text-slate-500">
                      <tr>
                        <th className="pb-2">Tipe</th>
                        <th className="pb-2">Nomor Seri</th>
                        <th className="pb-2">Ch</th>
                        <th className="pb-2">Terpasang</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {device.data.sensors.map((sensor) => (
                        <tr key={sensor.installation_id}>
                          <td className="py-2 text-slate-900">{sensor.sensor_type}</td>
                          <td className="py-2 font-mono text-xs text-slate-600">
                            {sensor.serial_number}
                          </td>
                          <td className="py-2 text-slate-600">{sensor.channel}</td>
                          <td className="py-2 text-xs text-slate-500">
                            {formatDateTime(sensor.installed_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">Riwayat Status</h2>
              {device.data.status_history.length === 0 ? (
                <p className="text-sm text-slate-500">Belum ada perubahan status.</p>
              ) : (
                <ol className="space-y-2 text-sm">
                  {device.data.status_history.map((entry, index) => (
                    <li key={index} className="flex flex-wrap gap-x-2 text-slate-700">
                      <span className="font-medium">
                        {entry.from_status ? `${entry.from_status} → ` : ''}
                        {entry.to_status}
                      </span>
                      <span className="text-xs text-slate-500">
                        {formatDateTime(entry.changed_at)}
                      </span>
                      {entry.reason && (
                        <span className="w-full text-xs text-slate-500">{entry.reason}</span>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
