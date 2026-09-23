'use client';

import Link from 'next/link';
import { useState } from 'react';
import { apiFetch, ApiError, type DeviceDetail, type DeviceOverview } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useApi } from '@/lib/use-api';
import { Modal } from '@/components/modal';
import { Pagination, type PaginationMeta } from '@/components/pagination';
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
  pagination: PaginationMeta;
}

interface PaginatedSensors {
  rows: SensorListItem[];
  pagination: PaginationMeta;
}

interface LocationOption {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  altitude_m: number;
  device_count: number;
}

interface SensorTypeItem {
  key: string;
  display_name: string;
  unit: string;
  min_valid: number;
  max_valid: number;
  precision: number;
  is_cumulative: boolean;
  unit_per_count: number | null;
  is_circular: boolean;
}

interface InstallationHistoryItem {
  id: string;
  device_code: string;
  device_name: string;
  channel: number;
  installed_at: string;
  removed_at: string | null;
  is_current: boolean;
  notes: string | null;
}

interface CalibrationItem {
  id: string;
  offset: number;
  scale: number;
  effective_from: string;
  effective_to: string | null;
  is_current: boolean;
  notes: string | null;
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
                          Detail →
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination meta={devices.data.pagination} onChange={setPage} label="device" />
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
  const [managing, setManaging] = useState<SensorListItem | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [typeFilter, setTypeFilter] = useState('');
  const [page, setPage] = useState(1);

  const sensorTypes = useApi<SensorTypeItem[]>(
    async () => (await apiFetch<SensorTypeItem[]>('/sensor-types')).data,
    [reloadToken],
  );

  const sensors = useApi<PaginatedSensors>(
    async () => {
      const result = await apiFetch<SensorListItem[]>('/sensors', {
        query: { page, per_page: 20, sensor_type: typeFilter || undefined },
      });

      return {
        rows: result.data,
        pagination: result.meta.pagination as PaginationMeta,
      };
    },
    [reloadToken, typeFilter, page],
  );

  const devices = useApi<DeviceOverview[]>(
    async () => (await apiFetch<DeviceOverview[]>('/dashboard/overview')).data,
    [reloadToken],
  );

  const refreshAll = () => setReloadToken((value) => value + 1);

  return (
    <div className="space-y-4">
      <SensorTypesPanel types={sensorTypes} onChanged={refreshAll} />

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-600">Tipe sensor</span>
          <select
            value={typeFilter}
            onChange={(event) => {
              setTypeFilter(event.target.value);
              // Kembali ke halaman pertama: halaman 5 dari hasil lama hampir
              // selalu di luar jangkauan hasil yang baru disaring.
              setPage(1);
            }}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">Semua tipe</option>
            {sensorTypes.data?.map((type) => (
              <option key={type.key} value={type.key}>
                {type.key}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="ml-auto rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
        >
          Tambah sensor
        </button>
      </div>

      {sensors.isLoading && <LoadingState label="Memuat sensor..." />}
      {sensors.error && !sensors.data && (
        <ErrorState error={sensors.error} onRetry={sensors.refresh} />
      )}

      {sensors.data && sensors.data.rows.length === 0 && (
        <EmptyState
          title="Tidak ada sensor yang cocok"
          description="Ubah filter tipe, atau daftarkan sensor baru."
        />
      )}

      {sensors.data && sensors.data.rows.length > 0 && (
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
                {sensors.data.rows.map((sensor) => (
                  <tr key={sensor.id}>
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
                        onClick={() => setManaging(sensor)}
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Kelola
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination meta={sensors.data.pagination} onChange={setPage} label="sensor" />
        </div>
      )}

      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="Daftarkan Sensor Fisik"
        description="Sensor didaftarkan lebih dulu sebagai barang, baru kemudian dipasang ke device."
      >
        {showCreate && (
          <CreateSensorForm types={sensorTypes.data ?? []} onCreated={refreshAll} />
        )}
      </Modal>

      <Modal
        open={managing !== null}
        onClose={() => setManaging(null)}
        title={managing ? `Kelola ${managing.serial_number}` : 'Kelola Sensor'}
        description={managing ? `Tipe ${managing.sensor_type}` : undefined}
        size="lg"
      >
        {managing && (
          <SensorActions
            key={managing.id}
            sensor={managing}
            devices={devices.data ?? []}
            onChanged={refreshAll}
          />
        )}
      </Modal>
    </div>
  );
}

/**
 * Master data tipe sensor (Bagian B.1).
 *
 * Ditampilkan sebagai tabel terbuka, bukan disembunyikan di balik menu, karena
 * inilah yang menentukan rentang valid setiap pembacaan: nilai di luar
 * min/max di sini yang ditandai `OUT_OF_RANGE` saat ingestion. Tanpa
 * menampilkannya, angka batas itu hanya ada di dalam database.
 */
function SensorTypesPanel({
  types,
  onChanged,
}: {
  types: ReturnType<typeof useApi<SensorTypeItem[]>>;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex items-center gap-2 text-sm font-semibold text-slate-900"
        >
          <span className="text-xs text-slate-400">{open ? '▾' : '▸'}</span>
          Tipe Sensor
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-normal text-slate-600">
            {types.data?.length ?? '—'}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          Tambah tipe
        </button>
      </div>

      {open && (
        <div className="overflow-x-auto border-t border-slate-200">
          {types.isLoading && <LoadingState label="Memuat tipe sensor..." />}
          {types.error && !types.data && (
            <ErrorState error={types.error} onRetry={types.refresh} />
          )}

          {types.data && (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Kunci</th>
                  <th className="px-4 py-3">Nama</th>
                  <th className="px-4 py-3">Satuan</th>
                  <th className="px-4 py-3">Rentang valid</th>
                  <th className="px-4 py-3">Presisi</th>
                  <th className="px-4 py-3">Sifat</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {types.data.map((type) => (
                  <tr key={type.key}>
                    <td className="px-4 py-3 font-mono text-xs text-slate-700">{type.key}</td>
                    <td className="px-4 py-3 text-slate-900">{type.display_name}</td>
                    <td className="px-4 py-3 text-slate-600">{type.unit}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">
                      {type.min_valid} … {type.max_valid}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">{type.precision} desimal</td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {/* Dua sifat yang mengubah cara nilainya diperlakukan, bukan
                          sekadar keterangan: kumulatif dihitung sebagai selisih,
                          dan sirkular dirata-ratakan secara vektor. */}
                      {type.is_cumulative && (
                        <span className="mr-1 rounded bg-amber-50 px-1.5 py-0.5 text-amber-800">
                          kumulatif{type.unit_per_count ? ` · ${type.unit_per_count}/tip` : ''}
                        </span>
                      )}
                      {type.is_circular && (
                        <span className="rounded bg-sky-50 px-1.5 py-0.5 text-sky-800">
                          sirkular
                        </span>
                      )}
                      {!type.is_cumulative && !type.is_circular && '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title="Tambah Tipe Sensor"
        description="Menambah tipe TIDAK memerlukan perubahan skema — konsekuensi langsung dari penyimpanan narrow."
      >
        {showForm && (
          <CreateSensorTypeForm
            onCreated={() => {
              onChanged();
              types.refresh();
            }}
          />
        )}
      </Modal>
    </div>
  );
}

function CreateSensorTypeForm({ onCreated }: { onCreated: () => void }) {
  const [key, setKey] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [unit, setUnit] = useState('');
  const [minValid, setMinValid] = useState('0');
  const [maxValid, setMaxValid] = useState('100');
  const [precision, setPrecision] = useState('2');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);

    try {
      await apiFetch('/sensor-types', {
        method: 'POST',
        body: JSON.stringify({
          key,
          display_name: displayName,
          unit,
          min_valid: Number(minValid),
          max_valid: Number(maxValid),
          precision: Number(precision),
        }),
      });

      setSaved(true);
      setKey('');
      setDisplayName('');
      setUnit('');
      onCreated();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError('UNKNOWN', 'Gagal', 0));
    } finally {
      setBusy(false);
    }
  }

  const inputClass = 'w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm';

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-600">Kunci *</span>
          <input
            required
            value={key}
            onChange={(event) => setKey(event.target.value.toLowerCase())}
            placeholder="soil_moisture"
            className={inputClass}
          />
          <span className="mt-1 block text-xs text-slate-400">
            Huruf kecil, angka, garis bawah. Inilah nilai <code>s</code> pada payload device.
          </span>
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-600">Nama tampilan *</span>
          <input
            required
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Kelembapan Tanah"
            className={inputClass}
          />
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-600">Satuan *</span>
          <input
            required
            value={unit}
            onChange={(event) => setUnit(event.target.value)}
            placeholder="%"
            className={inputClass}
          />
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-600">Minimum valid *</span>
          <input
            required
            type="number"
            step="any"
            value={minValid}
            onChange={(event) => setMinValid(event.target.value)}
            className={inputClass}
          />
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-600">Maksimum valid *</span>
          <input
            required
            type="number"
            step="any"
            value={maxValid}
            onChange={(event) => setMaxValid(event.target.value)}
            className={inputClass}
          />
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-600">Presisi</span>
          <input
            type="number"
            min={0}
            max={6}
            value={precision}
            onChange={(event) => setPrecision(event.target.value)}
            className={inputClass}
          />
        </label>
      </div>

      <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
        Rentang valid bukan penyaring: pembacaan di luar rentang tetap disimpan dan hanya ditandai
        <span className="mx-1 font-mono">OUT_OF_RANGE</span>. Nilai 150% adalah bukti sensor rusak —
        bukti yang hilang kalau barisnya dibuang.
      </p>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {error.message} <span className="font-mono text-xs">({error.code})</span>
        </p>
      )}

      {saved && !error && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Tipe sensor tersimpan.
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {busy ? 'Menyimpan...' : 'Simpan'}
      </button>
    </form>
  );
}

function CreateSensorForm({
  types,
  onCreated,
}: {
  types: SensorTypeItem[];
  onCreated: () => void;
}) {
  const [serialNumber, setSerialNumber] = useState('');
  const [sensorType, setSensorType] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);

    try {
      await apiFetch('/sensors', {
        method: 'POST',
        body: JSON.stringify({
          serial_number: serialNumber,
          sensor_type: sensorType,
          ...(manufacturer ? { manufacturer } : {}),
          ...(model ? { model } : {}),
        }),
      });

      setSaved(true);
      setSerialNumber('');
      setManufacturer('');
      setModel('');
      onCreated();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError('UNKNOWN', 'Gagal', 0));
    } finally {
      setBusy(false);
    }
  }

  const inputClass = 'w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm';

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-600">Nomor seri *</span>
          <input
            required
            value={serialNumber}
            onChange={(event) => setSerialNumber(event.target.value.toUpperCase())}
            placeholder="TEMP-SN-0042"
            className={inputClass}
          />
          <span className="mt-1 block text-xs text-slate-400">
            Harus unik. Inilah identitas barangnya, yang bertahan meski berpindah device.
          </span>
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-600">Tipe sensor *</span>
          <select
            required
            value={sensorType}
            onChange={(event) => setSensorType(event.target.value)}
            className={inputClass}
          >
            <option value="">Pilih tipe</option>
            {types.map((type) => (
              <option key={type.key} value={type.key}>
                {type.key} — {type.display_name} ({type.unit})
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-600">Produsen</span>
          <input
            value={manufacturer}
            onChange={(event) => setManufacturer(event.target.value)}
            placeholder="Sensirion"
            className={inputClass}
          />
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-600">Model</span>
          <input
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder="SHT31"
            className={inputClass}
          />
        </label>
      </div>

      <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
        Sensor yang baru dibuat berstatus <span className="font-mono">IN_STOCK</span> — terdaftar
        sebagai barang, belum terpasang di mana pun. Pemasangannya dilakukan lewat tombol Kelola.
      </p>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {error.message} <span className="font-mono text-xs">({error.code})</span>
        </p>
      )}

      {saved && !error && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Sensor tersimpan.
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {busy ? 'Menyimpan...' : 'Simpan'}
      </button>
    </form>
  );
}

function SensorActions({
  sensor,
  devices,
  onChanged,
}: {
  sensor: SensorListItem;
  devices: DeviceOverview[];
  onChanged: () => void;
}) {
  const [deviceId, setDeviceId] = useState('');
  const [channel, setChannel] = useState(0);
  const [offset, setOffset] = useState('0');
  const [scale, setScale] = useState('1');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [notes, setNotes] = useState('');
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  // Riwayat pemasangan dan riwayat kalibrasi: keduanya inti Bagian B, dan
  // keduanya hanya bermakna kalau bisa dilihat, bukan sekadar tersimpan.
  const installations = useApi<InstallationHistoryItem[]>(
    async () =>
      (await apiFetch<InstallationHistoryItem[]>(`/sensors/${sensor.id}/installations`)).data,
    [sensor.id, reloadToken],
  );

  const calibrations = useApi<CalibrationItem[]>(
    async () => (await apiFetch<CalibrationItem[]>(`/sensors/${sensor.id}/calibrations`)).data,
    [sensor.id, reloadToken],
  );

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setMessage(null);

    try {
      setMessage({ kind: 'ok', text: await action() });
      setReloadToken((value) => value + 1);
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

  const inputClass = 'w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm';

  return (
    <div className="space-y-5">
      {/* --- Pemasangan (B.2) --- */}
      <section>
        <h3 className="text-sm font-semibold text-slate-900">Pemasangan</h3>

        {sensor.installed_on ? (
          <div className="mt-2 space-y-3">
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
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-slate-600">Device tujuan</span>
              <select
                value={deviceId}
                onChange={(event) => setDeviceId(event.target.value)}
                className={inputClass}
              >
                <option value="">Pilih device</option>
                {devices.map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.device_code} — {device.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-slate-600">Channel</span>
              <input
                type="number"
                min={0}
                value={channel}
                onChange={(event) => setChannel(Number(event.target.value))}
                className={inputClass}
              />
              <span className="mt-1 block text-xs text-slate-400">
                Pakai channel 1 untuk sensor kedua bertipe sama pada device yang sama.
              </span>
            </label>

            <div className="sm:col-span-2">
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
          </div>
        )}
      </section>

      {/* --- Riwayat pemasangan (B.2) --- */}
      <section className="border-t border-slate-200 pt-4">
        <h3 className="text-sm font-semibold text-slate-900">Riwayat Pemasangan</h3>
        <p className="mt-0.5 text-xs text-slate-500">
          Pemindahan sensor membuat baris baru dan menutup yang lama — tidak ada baris yang ditimpa,
          sehingga data lama tetap terhubung ke device tempat sensornya berada saat itu.
        </p>

        {installations.isLoading && <p className="mt-2 text-xs text-slate-500">Memuat...</p>}

        {installations.data && installations.data.length === 0 && (
          <p className="mt-2 text-xs text-slate-500">Sensor ini belum pernah dipasang.</p>
        )}

        {installations.data && installations.data.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs">
            {installations.data.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-x-2 text-slate-600">
                <span className="font-mono text-slate-800">{row.device_code}</span>
                <span>ch {row.channel}</span>
                <span className="text-slate-400">·</span>
                <span>{formatDateTime(row.installed_at)}</span>
                <span className="text-slate-400">→</span>
                {row.is_current ? (
                  <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-800">
                    masih terpasang
                  </span>
                ) : (
                  <span>{formatDateTime(row.removed_at)}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* --- Kalibrasi (B.3) --- */}
      <section className="border-t border-slate-200 pt-4">
        <h3 className="text-sm font-semibold text-slate-900">Kalibrasi</h3>
        <p className="mt-0.5 text-xs text-slate-500">
          Rumusnya: nilai = mentah × scale + offset. Kalibrasi baru menutup yang sedang berlaku pada
          waktu mulainya, dan data lama <strong>tidak</strong> dihitung ulang — pembacaan yang sudah
          tersimpan tetap memakai koreksi yang memang berlaku saat pengukurannya terjadi.
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-600">Offset</span>
            <input
              value={offset}
              onChange={(event) => setOffset(event.target.value)}
              className={inputClass}
            />
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-600">Scale</span>
            <input
              value={scale}
              onChange={(event) => setScale(event.target.value)}
              className={inputClass}
            />
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-600">Berlaku sejak</span>
            <input
              type="datetime-local"
              value={effectiveFrom}
              onChange={(event) => setEffectiveFrom(event.target.value)}
              className={inputClass}
            />
            <span className="mt-1 block text-xs text-slate-400">
              Kosongkan untuk berlaku mulai sekarang. Waktu lokal WIB.
            </span>
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-600">Catatan</span>
            <input
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Hasil kalibrasi ulang di lab"
              className={inputClass}
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
                body: JSON.stringify({
                  offset: Number(offset),
                  scale: Number(scale),
                  // Input datetime-local memberi waktu lokal tanpa zona. Diubah
                  // ke UTC di sini supaya yang dikirim ke API selalu absolut,
                  // sesuai aturan "UTC di mana-mana kecuali saat render".
                  ...(effectiveFrom
                    ? { effective_from: new Date(effectiveFrom).toISOString() }
                    : {}),
                  ...(notes ? { notes } : {}),
                }),
              });
              return 'Kalibrasi tersimpan.';
            })
          }
          className="mt-3 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          Simpan kalibrasi
        </button>
      </section>

      {/* --- Riwayat kalibrasi (B.3) --- */}
      <section className="border-t border-slate-200 pt-4">
        <h3 className="text-sm font-semibold text-slate-900">Riwayat Kalibrasi</h3>

        {calibrations.isLoading && <p className="mt-2 text-xs text-slate-500">Memuat...</p>}

        {calibrations.data && calibrations.data.length === 0 && (
          <p className="mt-2 text-xs text-slate-500">Belum ada kalibrasi; koreksi dianggap netral.</p>
        )}

        {calibrations.data && calibrations.data.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs">
            {calibrations.data.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-x-2 text-slate-600">
                <span className="font-mono text-slate-800">
                  ×{row.scale} {row.offset >= 0 ? '+' : '−'}
                  {Math.abs(row.offset)}
                </span>
                <span className="text-slate-400">·</span>
                <span>{formatDateTime(row.effective_from)}</span>
                <span className="text-slate-400">→</span>
                {row.is_current ? (
                  <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-800">
                    berlaku
                  </span>
                ) : (
                  <span>{formatDateTime(row.effective_to)}</span>
                )}
                {row.notes && <span className="w-full text-slate-500">{row.notes}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {message && (
        <p
          className={`rounded-md px-3 py-2 text-sm ${
            message.kind === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'
          }`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
