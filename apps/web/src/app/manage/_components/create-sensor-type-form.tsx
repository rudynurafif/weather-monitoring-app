'use client';

import { useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api';

export function CreateSensorTypeForm({ onCreated }: { onCreated: () => void }) {
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
