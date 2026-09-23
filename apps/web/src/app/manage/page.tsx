'use client';

import Link from 'next/link';
import { useState } from 'react';
import { apiFetch, ApiError, type DeviceDetail, type DeviceOverview } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useApi } from '@/lib/use-api';
import { Modal } from '@/components/modal';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';

interface DeviceListItem {
  id: string;
  device_code: string;
  name: string;
  status: string;
  firmware_version: string | null;
  location: { id: string; name: string } | null;
  last_seen_at: string | null;
}

interface RotatedCredential {
  key_id: string;
  device_key: string;
  previous_credentials_valid_until: string;
}

interface PaginatedDevices {
  rows: DeviceListItem[];
  pagination: { page: number; per_page: number; total: number; total_pages: number };
}

interface LocationOption {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  altitude_m: number;
  device_count: number;
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
  const [editing, setEditing] = useState<DeviceListItem | null>(null);
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
          onClick={() => {
            setShowForm(true);
            setEditing(null);
          }}
          className="ml-auto rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
        >
          Tambah device
        </button>
      </div>

      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title="Daftarkan Device Baru"
        description="Identitas stasiun beserta lokasi pemasangannya."
        size="lg"
      >
        {showForm && (
          <CreateDeviceForm
            onCreated={() => {
              setReloadToken((value) => value + 1);
            }}
          />
        )}
      </Modal>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing ? `Ubah Device ${editing.device_code}` : 'Ubah Device'}
        description="Kode device tidak bisa diubah — ia dipakai firmware sebagai identitas di setiap payload."
        size="lg"
      >
        {editing && (
          <EditDeviceForm
            key={editing.id}
            device={editing}
            onSaved={() => {
              setReloadToken((value) => value + 1);
            }}
            onClose={() => setEditing(null)}
          />
        )}
      </Modal>

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
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            setEditing(device);
                            setShowForm(false);
                          }}
                          className="text-xs font-medium text-slate-600 hover:text-slate-900"
                        >
                          Ubah
                        </button>
                        <Link
                          href={`/devices/${device.id}`}
                          className="text-xs font-medium text-slate-700 hover:text-slate-900"
                        >
                          Lihat →
                        </Link>
                      </div>
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
  const [firmware, setFirmware] = useState('');

  /**
   * Dua cara menentukan lokasi, sesuai dua keadaan lapangan yang sama-sama
   * nyata: stasiun baru di tempat baru, dan perangkat pengganti di tiang yang
   * sama. Yang kedua justru yang paling penting — data lama dan data baru harus
   * menunjuk satu lokasi yang sama agar perbandingan antar tahun tetap sahih.
   */
  const [locationMode, setLocationMode] = useState<'new' | 'existing'>('new');
  const [locationId, setLocationId] = useState('');
  const [locName, setLocName] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [altitude, setAltitude] = useState('');
  const [locDescription, setLocDescription] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [credential, setCredential] = useState<string | null>(null);

  const locations = useApi<LocationOption[]>(
    async () => (await apiFetch<LocationOption[]>('/locations')).data,
    [],
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const payload: Record<string, unknown> = {
        device_code: deviceCode,
        name,
        ...(firmware ? { firmware_version: firmware } : {}),
      };

      // Hanya SATU dari keduanya yang dikirim; backend menolak bila keduanya ada.
      if (locationMode === 'existing') {
        payload.location_id = locationId;
      } else {
        payload.location = {
          name: locName,
          latitude: Number(latitude),
          longitude: Number(longitude),
          altitude_m: Number(altitude),
          ...(locDescription ? { description: locDescription } : {}),
        };
      }

      const result = await apiFetch<DeviceDetail & { credential: { device_key: string } }>(
        '/devices',
        { method: 'POST', body: JSON.stringify(payload) },
      );

      setCredential(result.data.credential.device_key);
      setDeviceCode('');
      setName('');
      setFirmware('');
      setLocName('');
      setLatitude('');
      setLongitude('');
      setAltitude('');
      setLocDescription('');
      locations.refresh();
      onCreated();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError('UNKNOWN', 'Gagal', 0));
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass = 'w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm';

  return (
    <form onSubmit={submit} className="space-y-4">

      {/* --- Identitas device --- */}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-600">Kode device *</span>
          <input
            required
            value={deviceCode}
            onChange={(event) => setDeviceCode(event.target.value.toUpperCase())}
            placeholder="WS-GRT-010"
            className={inputClass}
          />
          <span className="mt-1 block text-xs text-slate-400">
            Huruf kapital, angka, dan tanda hubung. Nilai inilah yang dikirim device di payload.
          </span>
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-600">Nama stasiun *</span>
          <input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Stasiun Cuaca Garut Selatan"
            className={inputClass}
          />
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-600">Versi firmware</span>
          <input
            value={firmware}
            onChange={(event) => setFirmware(event.target.value)}
            placeholder="1.4.2"
            className={inputClass}
          />
          <span className="mt-1 block text-xs text-slate-400">
            Opsional. Diperbarui sendiri saat device mulai mengirim.
          </span>
        </label>
      </div>

      {/* --- Lokasi (ketentuan Bagian A.1: koordinat, nama lokasi, ketinggian) --- */}
      <fieldset className="rounded-md border border-slate-200 p-3">
        <legend className="px-1 text-xs font-semibold text-slate-700">Lokasi pemasangan</legend>

        <div className="mb-3 flex flex-wrap gap-4 text-sm">
          {(
            [
              ['new', 'Lokasi baru'],
              ['existing', 'Pilih lokasi yang sudah ada'],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-1.5">
              <input
                type="radio"
                name="location-mode"
                checked={locationMode === value}
                onChange={() => setLocationMode(value)}
              />
              <span className="text-slate-700">{label}</span>
            </label>
          ))}
        </div>

        {locationMode === 'existing' ? (
          <div className="space-y-2">
            {locations.isLoading && <p className="text-xs text-slate-500">Memuat lokasi...</p>}

            {locations.error && (
              <p className="text-xs text-red-700">Gagal memuat lokasi ({locations.error.code}).</p>
            )}

            {locations.data && locations.data.length === 0 && (
              <p className="text-xs text-slate-500">
                Belum ada lokasi terdaftar. Pakai pilihan &quot;Lokasi baru&quot;.
              </p>
            )}

            {locations.data && locations.data.length > 0 && (
              <label className="block text-sm">
                <span className="mb-1 block text-xs font-medium text-slate-600">Lokasi *</span>
                <select
                  required
                  value={locationId}
                  onChange={(event) => setLocationId(event.target.value)}
                  className={inputClass}
                >
                  <option value="">Pilih lokasi</option>
                  {locations.data.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name} — {location.altitude_m} mdpl ({location.device_count} device)
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-xs text-slate-400">
                  Dipakai saat memasang perangkat pengganti di lokasi yang sama.
                </span>
              </label>
            )}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm lg:col-span-2">
              <span className="mb-1 block text-xs font-medium text-slate-600">Nama lokasi *</span>
              <input
                required
                value={locName}
                onChange={(event) => setLocName(event.target.value)}
                placeholder="Garut Selatan"
                className={inputClass}
              />
            </label>

            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-slate-600">Lintang *</span>
              <input
                required
                type="number"
                step="any"
                min={-90}
                max={90}
                value={latitude}
                onChange={(event) => setLatitude(event.target.value)}
                placeholder="-7.214"
                className={inputClass}
              />
              <span className="mt-1 block text-xs text-slate-400">Negatif = belahan selatan.</span>
            </label>

            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-slate-600">Bujur *</span>
              <input
                required
                type="number"
                step="any"
                min={-180}
                max={180}
                value={longitude}
                onChange={(event) => setLongitude(event.target.value)}
                placeholder="107.900"
                className={inputClass}
              />
              <span className="mt-1 block text-xs text-slate-400">Positif = belahan timur.</span>
            </label>

            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-slate-600">
                Ketinggian (mdpl) *
              </span>
              <input
                required
                type="number"
                step="any"
                min={-500}
                max={9000}
                value={altitude}
                onChange={(event) => setAltitude(event.target.value)}
                placeholder="717"
                className={inputClass}
              />
              <span className="mt-1 block text-xs text-slate-400">
                Dipakai menafsirkan tekanan udara dan suhu.
              </span>
            </label>

            <label className="text-sm lg:col-span-3">
              <span className="mb-1 block text-xs font-medium text-slate-600">Keterangan</span>
              <input
                value={locDescription}
                onChange={(event) => setLocDescription(event.target.value)}
                placeholder="Halaman kantor BPP Kecamatan"
                className={inputClass}
              />
            </label>
          </div>
        )}
      </fieldset>

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

/**
 * Transisi status yang diizinkan, dicerminkan dari backend.
 *
 * Duplikasi ini sengaja: tujuannya supaya pengguna tidak ditawari pilihan yang
 * sudah pasti ditolak. Yang berwenang tetap backend — kalau daftar ini
 * ketinggalan, servernya yang menolak dengan `INVALID_STATUS_TRANSITION`, dan
 * pesannya ditampilkan apa adanya di bawah form.
 */
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  PROVISIONED: ['ACTIVE', 'MAINTENANCE', 'DECOMMISSIONED'],
  ACTIVE: ['MAINTENANCE', 'DECOMMISSIONED'],
  MAINTENANCE: ['ACTIVE', 'DECOMMISSIONED'],
  DECOMMISSIONED: [],
};

function EditDeviceForm({
  device,
  onSaved,
  onClose,
}: {
  device: DeviceListItem;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(device.name);
  const [firmware, setFirmware] = useState(device.firmware_version ?? '');
  const [locationId, setLocationId] = useState(device.location?.id ?? '');
  const [status, setStatus] = useState(device.status);
  const [statusReason, setStatusReason] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);
  const [rotated, setRotated] = useState<RotatedCredential | null>(null);

  const locations = useApi<LocationOption[]>(
    async () => (await apiFetch<LocationOption[]>('/locations')).data,
    [],
  );

  const statusChanged = status !== device.status;
  const statusOptions = [device.status, ...(ALLOWED_TRANSITIONS[device.status] ?? [])];

  /** Satu pembungkus untuk ketiga aksi, supaya penanganan error-nya seragam. */
  async function run(action: () => Promise<void>) {
    setSubmitting(true);
    setError(null);
    setSaved(false);

    try {
      await action();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError('UNKNOWN', 'Gagal', 0));
    } finally {
      setSubmitting(false);
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();

    await run(async () => {
      // Hanya kirim field yang benar-benar berubah. PATCH berarti perubahan
      // sebagian: mengirim ulang nilai yang sama akan mencatat riwayat status
      // palsu dan menimpa perubahan orang lain tanpa alasan.
      const payload: Record<string, unknown> = {};
      if (name !== device.name) payload.name = name;
      if (firmware !== (device.firmware_version ?? '')) payload.firmware_version = firmware;
      if (locationId !== (device.location?.id ?? '')) payload.location_id = locationId;

      if (statusChanged) {
        payload.status = status;
        if (statusReason) payload.status_reason = statusReason;
      }

      if (Object.keys(payload).length === 0) {
        setSaved(true);
        return;
      }

      await apiFetch(`/devices/${device.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      setSaved(true);
      setStatusReason('');
      onSaved();
    });
  }

  async function rotate() {
    await run(async () => {
      const result = await apiFetch<RotatedCredential>(`/devices/${device.id}/credentials/rotate`, {
        method: 'POST',
      });
      setRotated(result.data);
    });
  }

  async function softDelete() {
    // Konfirmasi karena aksinya mencabut kredensial device dan menghentikan
    // pengirimannya. Barisnya sendiri tidak hilang — pembacaan historisnya
    // tetap utuh dan tetap bisa di-query.
    const confirmed = window.confirm(
      `Hapus ${device.device_code}?\n\n` +
        'Device ditandai DECOMMISSIONED dan kredensialnya dicabut, sehingga ia tidak ' +
        'bisa lagi mengirim data. Seluruh data historisnya tetap disimpan.',
    );

    if (!confirmed) return;

    await run(async () => {
      await apiFetch(`/devices/${device.id}`, { method: 'DELETE' });
      onSaved();
      onClose();
    });
  }

  const inputClass = 'w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm';

  return (
    <form onSubmit={save} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-600">Nama stasiun</span>
          <input value={name} onChange={(event) => setName(event.target.value)} className={inputClass} />
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-600">Versi firmware</span>
          <input
            value={firmware}
            onChange={(event) => setFirmware(event.target.value)}
            placeholder="1.4.2"
            className={inputClass}
          />
          <span className="mt-1 block text-xs text-slate-400">
            Biasanya terisi sendiri dari payload device.
          </span>
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-600">Lokasi</span>
          <select
            value={locationId}
            onChange={(event) => setLocationId(event.target.value)}
            className={inputClass}
          >
            <option value="">— tanpa lokasi —</option>
            {locations.data?.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name} — {location.altitude_m} mdpl
              </option>
            ))}
          </select>
          {locations.error && (
            <span className="mt-1 block text-xs text-red-700">Gagal memuat daftar lokasi.</span>
          )}
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-600">Status</span>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className={inputClass}
          >
            {statusOptions.map((value) => (
              <option key={value} value={value}>
                {value}
                {value === device.status ? ' (sekarang)' : ''}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-slate-400">
            {device.status === 'DECOMMISSIONED'
              ? 'DECOMMISSIONED bersifat final — tidak ada transisi keluar.'
              : 'Hanya transisi yang diizinkan yang ditampilkan.'}
          </span>
        </label>
      </div>

      {statusChanged && (
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-600">
            Alasan perubahan status
          </span>
          <input
            value={statusReason}
            onChange={(event) => setStatusReason(event.target.value)}
            placeholder="Turun untuk penggantian sensor kelembapan"
            className={inputClass}
          />
          <span className="mt-1 block text-xs text-slate-400">
            Tersimpan di riwayat status dan tampil di halaman detail stasiun.
          </span>
        </label>
      )}

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {error.message} <span className="font-mono text-xs">({error.code})</span>
        </p>
      )}

      {saved && !error && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Perubahan tersimpan.
        </p>
      )}

      {rotated && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2">
          <p className="text-xs font-semibold text-amber-900">
            Kredensial baru. Salin sekarang — nilainya tidak akan ditampilkan lagi.
          </p>
          <code className="mt-1 block break-all rounded bg-white px-2 py-1 font-mono text-xs text-amber-900">
            {rotated.device_key}
          </code>
          <p className="mt-1 text-xs text-amber-800">
            Kredensial lama masih diterima sampai{' '}
            {formatDateTime(rotated.previous_credentials_valid_until)}, agar device yang sedang
            offline saat rotasi tidak terkunci di luar sistem.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {submitting ? 'Menyimpan...' : 'Simpan perubahan'}
        </button>

        <button
          type="button"
          onClick={rotate}
          disabled={submitting}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Rotasi kredensial
        </button>

        <button
          type="button"
          onClick={softDelete}
          disabled={submitting}
          className="ml-auto rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          Hapus device
        </button>
      </div>
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
