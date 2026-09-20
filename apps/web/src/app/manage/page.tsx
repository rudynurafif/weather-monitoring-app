'use client';

import Link from 'next/link';
import { useState } from 'react';
import { apiFetch, ApiError, type DeviceDetail, type DeviceOverview } from '@/lib/api';
import { connectivityStyle, formatDateTime } from '@/lib/format';
import { useApi } from '@/lib/use-api';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';

interface DeviceListItem {
  id: string;
  device_code: string;
  name: string;
  status: string;
  location: { name: string } | null;
  last_seen_at: string | null;
}

interface PaginatedDevices {
  rows: DeviceListItem[];
  pagination: { page: number; per_page: number; total: number; total_pages: number };
}

interface SensorListItem {
  id: string;
  serial_number: string;
  sensor_type: string;
  status: string;
  installed_on: { device_code: string; channel: number } | null;
}

const STATUSES = ['', 'PROVISIONED', 'ACTIVE', 'MAINTENANCE', 'DECOMMISSIONED'];

export default function ManagePage() {
  const [tab, setTab] = useState<'devices' | 'sensors'>('devices');

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Manajemen</h1>
        <p className="text-sm text-slate-500">Pendaftaran device, pemasangan sensor, dan kalibrasi.</p>
      </div>

      <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5">
        {(['devices', 'sensors'] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`rounded px-3 py-1 text-sm font-medium transition ${
              tab === key ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {key === 'devices' ? 'Device' : 'Sensor & Kalibrasi'}
          </button>
        ))}
      </div>

      {tab === 'devices' ? <DevicesPanel /> : <SensorsPanel />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Device
// ---------------------------------------------------------------------------

function DevicesPanel() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const devices = useApi<PaginatedDevices>(
    async () => {
      const result = await apiFetch<DeviceListItem[]>('/devices', {
        query: { page, per_page: 10, status: status || undefined, q: q || undefined },
      });

      return {
        rows: result.data,
        pagination: result.meta.pagination as PaginatedDevices['pagination'],
      };
    },
    [page, status, q, reloadToken],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-600">Status</span>
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {value === '' ? 'Semua' : value}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-600">Cari</span>
          <input
            value={q}
            onChange={(event) => {
              setQ(event.target.value);
              setPage(1);
            }}
            placeholder="Kode atau nama"
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>

        <button
          type="button"
          onClick={() => setShowForm((value) => !value)}
          className="ml-auto rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
        >
          {showForm ? 'Tutup form' : 'Tambah device'}
        </button>
      </div>

      {showForm && (
        <CreateDeviceForm
          onCreated={() => {
            setReloadToken((value) => value + 1);
          }}
        />
      )}

      {devices.isLoading && <LoadingState label="Memuat daftar device..." />}
      {devices.error && !devices.data && (
        <ErrorState error={devices.error} onRetry={devices.refresh} />
      )}

      {devices.data && devices.data.rows.length === 0 && (
        <EmptyState
          title="Tidak ada device yang cocok"
          description="Ubah filter pencarian, atau daftarkan device baru."
        />
      )}

      {devices.data && devices.data.rows.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Kode</th>
                  <th className="px-4 py-3">Nama</th>
                  <th className="px-4 py-3">Lokasi</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Terakhir Terlihat</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {devices.data.rows.map((device) => (
                  <tr key={device.id}>
                    <td className="px-4 py-3 font-mono text-xs text-slate-700">
                      {device.device_code}
                    </td>
                    <td className="px-4 py-3 text-slate-900">{device.name}</td>
                    <td className="px-4 py-3 text-slate-600">{device.location?.name ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                        {device.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {formatDateTime(device.last_seen_at)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/devices/${device.id}`}
                        className="text-xs font-medium text-slate-700 hover:text-slate-900"
                      >
                        Lihat →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-xs text-slate-600">
            <span>
              Halaman {devices.data.pagination.page} dari {devices.data.pagination.total_pages} ·{' '}
              {devices.data.pagination.total} device
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                disabled={devices.data.pagination.page <= 1}
                className="rounded-md border border-slate-300 px-2 py-1 disabled:opacity-40"
              >
                Sebelumnya
              </button>
              <button
                type="button"
                onClick={() => setPage((value) => value + 1)}
                disabled={devices.data.pagination.page >= devices.data.pagination.total_pages}
                className="rounded-md border border-slate-300 px-2 py-1 disabled:opacity-40"
              >
                Berikutnya
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CreateDeviceForm({ onCreated }: { onCreated: () => void }) {
  const [deviceCode, setDeviceCode] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [credential, setCredential] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const result = await apiFetch<DeviceDetail & { credential: { device_key: string } }>(
        '/devices',
        { method: 'POST', body: JSON.stringify({ device_code: deviceCode, name }) },
      );

      setCredential(result.data.credential.device_key);
      setDeviceCode('');
      setName('');
      onCreated();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError('UNKNOWN', 'Gagal', 0));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">Daftarkan Device Baru</h2>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-600">Kode device</span>
          <input
            required
            value={deviceCode}
            onChange={(event) => setDeviceCode(event.target.value.toUpperCase())}
            placeholder="WS-GRT-004"
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
          <span className="mt-1 block text-xs text-slate-400">
            Huruf kapital, angka, dan tanda hubung.
          </span>
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-600">Nama</span>
          <input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Stasiun Cuaca Garut Selatan"
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>
      </div>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {error.message} <span className="font-mono text-xs">({error.code})</span>
        </p>
      )}

      {credential && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2">
          <p className="text-xs font-semibold text-emerald-900">
            Device dibuat. Salin kredensial ini sekarang — nilainya tidak akan ditampilkan lagi.
          </p>
          <code className="mt-1 block break-all rounded bg-white px-2 py-1 font-mono text-xs text-emerald-900">
            {credential}
          </code>
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {submitting ? 'Menyimpan...' : 'Simpan'}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Sensor & kalibrasi
// ---------------------------------------------------------------------------

function SensorsPanel() {
  const [reloadToken, setReloadToken] = useState(0);
  const [selectedSensor, setSelectedSensor] = useState<string>('');

  const sensors = useApi<SensorListItem[]>(
    async () => (await apiFetch<SensorListItem[]>('/sensors', { query: { per_page: 100 } })).data,
    [reloadToken],
  );

  const devices = useApi<DeviceOverview[]>(
    async () => (await apiFetch<DeviceOverview[]>('/dashboard/overview')).data,
    [reloadToken],
  );

  return (
    <div className="space-y-4">
      {sensors.isLoading && <LoadingState label="Memuat sensor..." />}
      {sensors.error && !sensors.data && (
        <ErrorState error={sensors.error} onRetry={sensors.refresh} />
      )}

      {sensors.data && sensors.data.length === 0 && (
        <EmptyState title="Belum ada sensor terdaftar" />
      )}

      {sensors.data && sensors.data.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Nomor Seri</th>
                  <th className="px-4 py-3">Tipe</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Terpasang di</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sensors.data.map((sensor) => (
                  <tr key={sensor.id} className={selectedSensor === sensor.id ? 'bg-slate-50' : ''}>
                    <td className="px-4 py-3 font-mono text-xs text-slate-700">
                      {sensor.serial_number}
                    </td>
                    <td className="px-4 py-3 text-slate-900">{sensor.sensor_type}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">{sensor.status}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {sensor.installed_on
                        ? `${sensor.installed_on.device_code} (ch ${sensor.installed_on.channel})`
                        : '— di gudang —'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedSensor(selectedSensor === sensor.id ? '' : sensor.id)
                        }
                        className="text-xs font-medium text-slate-700 hover:text-slate-900"
                      >
                        {selectedSensor === sensor.id ? 'Tutup' : 'Kelola'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selectedSensor && (
        <SensorActions
          sensor={sensors.data?.find((item) => item.id === selectedSensor) ?? null}
          devices={devices.data ?? []}
          onChanged={() => setReloadToken((value) => value + 1)}
        />
      )}
    </div>
  );
}

function SensorActions({
  sensor,
  devices,
  onChanged,
}: {
  sensor: SensorListItem | null;
  devices: DeviceOverview[];
  onChanged: () => void;
}) {
  const [deviceId, setDeviceId] = useState('');
  const [channel, setChannel] = useState(0);
  const [offset, setOffset] = useState('0');
  const [scale, setScale] = useState('1');
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (!sensor) return null;

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ kind: 'ok', text: await action() });
      onChanged();
    } catch (caught) {
      setMessage({
        kind: 'error',
        text: caught instanceof ApiError ? `${caught.message} (${caught.code})` : 'Gagal',
      });
    } finally {
      setBusy(false);
    }
  }

  const installedDevice = devices.find(
    (device) => device.device_code === sensor.installed_on?.device_code,
  );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">
          Pemasangan · {sensor.serial_number}
        </h2>

        {sensor.installed_on ? (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-slate-600">
              Terpasang di {sensor.installed_on.device_code}, channel {sensor.installed_on.channel}.
            </p>
            <p className="text-xs text-slate-500">
              Melepas sensor menutup baris riwayat dengan waktu pelepasan; data historis tetap
              terikat pada device ini.
            </p>
            <button
              type="button"
              disabled={busy || !installedDevice}
              onClick={() =>
                void run(async () => {
                  await apiFetch(`/devices/${installedDevice!.id}/sensors/${sensor.id}`, {
                    method: 'DELETE',
                    body: JSON.stringify({}),
                  });
                  return 'Sensor dilepas.';
                })
              }
              className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              Lepas sensor
            </button>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-slate-600">Device tujuan</span>
              <select
                value={deviceId}
                onChange={(event) => setDeviceId(event.target.value)}
                className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              >
                <option value="">Pilih device</option>
                {devices.map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.device_code} — {device.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-slate-600">Channel</span>
              <input
                type="number"
                min={0}
                value={channel}
                onChange={(event) => setChannel(Number(event.target.value))}
                className="w-24 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
              <span className="mt-1 block text-xs text-slate-400">
                Pakai channel 1 untuk sensor kedua bertipe sama pada device yang sama.
              </span>
            </label>

            <button
              type="button"
              disabled={busy || !deviceId}
              onClick={() =>
                void run(async () => {
                  await apiFetch(`/devices/${deviceId}/sensors`, {
                    method: 'POST',
                    body: JSON.stringify({ sensor_id: sensor.id, channel }),
                  });
                  return 'Sensor terpasang.';
                })
              }
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              Pasang sensor
            </button>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Kalibrasi</h2>
        <p className="mt-1 text-xs text-slate-500">
          Rumusnya: nilai = mentah × scale + offset. Kalibrasi baru berlaku mulai sekarang; data
          lama TIDAK dihitung ulang.
        </p>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-600">Offset</span>
            <input
              value={offset}
              onChange={(event) => setOffset(event.target.value)}
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-600">Scale</span>
            <input
              value={scale}
              onChange={(event) => setScale(event.target.value)}
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await apiFetch(`/sensors/${sensor.id}/calibrations`, {
                method: 'POST',
                body: JSON.stringify({ offset: Number(offset), scale: Number(scale) }),
              });
              return 'Kalibrasi tersimpan dan berlaku mulai sekarang.';
            })
          }
          className="mt-3 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          Simpan kalibrasi
        </button>
      </section>

      {message && (
        <p
          className={`lg:col-span-2 rounded-md px-3 py-2 text-sm ${
            message.kind === 'ok'
              ? 'bg-emerald-50 text-emerald-800'
              : 'bg-red-50 text-red-800'
          }`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
