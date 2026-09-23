'use client';

import { useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api';
import type { SensorTypeItem } from '@/types';

export function CreateSensorForm({
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
