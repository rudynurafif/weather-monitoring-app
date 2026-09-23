'use client';

import { useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import type { CreatedDevice, LocationOption } from '@/types';

export function CreateDeviceForm({ onCreated }: { onCreated: () => void }) {
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

      const result = await apiFetch<CreatedDevice>(
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
