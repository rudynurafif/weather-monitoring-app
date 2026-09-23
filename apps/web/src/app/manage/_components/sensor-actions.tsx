'use client';

import { useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useApi } from '@/lib/use-api';
import type {
  CalibrationItem,
  DeviceOverview,
  InstallationHistoryItem,
  SensorListItem,
} from '@/types';

export function SensorActions({
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
                window.confirm(`Yakin ingin melepas sensor ${sensor.serial_number} dari device ${installedDevice?.device_code}?`) &&
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
