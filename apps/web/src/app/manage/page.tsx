'use client';

import { useState } from 'react';
import { DevicesPanel } from './_components/devices-panel';
import { SensorsPanel } from './_components/sensors-panel';

/**
 * Halaman manajemen: kerangka dan pemilih tab saja.
 *
 * Isi tiap tab ada di `_components/`. Awalan garis bawah menandai folder itu
 * sebagai folder privat menurut konvensi Next.js — isinya tidak pernah menjadi
 * rute, hanya komponen yang dipakai halaman ini.
 */
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
