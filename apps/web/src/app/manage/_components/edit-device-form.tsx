'use client';

import { useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useApi } from '@/lib/use-api';
import type { DeviceListItem, LocationOption, RotatedCredential } from '@/types';

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  PROVISIONED: ['ACTIVE', 'MAINTENANCE', 'DECOMMISSIONED'],
  ACTIVE: ['MAINTENANCE', 'DECOMMISSIONED'],
  MAINTENANCE: ['ACTIVE', 'DECOMMISSIONED'],
  DECOMMISSIONED: [],
};

export function EditDeviceForm({
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
