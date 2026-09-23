'use client';

import { useState } from 'react';
import { ErrorState, LoadingState } from '@/components/states';
import { Modal } from '@/components/modal';
import type { UseApiState } from '@/lib/use-api';
import type { SensorTypeItem } from '@/types';
import { CreateSensorTypeForm } from './create-sensor-type-form';

/**
 * Master data tipe sensor (Bagian B.1).
 *
 * Ditampilkan sebagai tabel terbuka, bukan disembunyikan di balik menu, karena
 * inilah yang menentukan rentang valid setiap pembacaan: nilai di luar
 * min/max di sini yang ditandai `OUT_OF_RANGE` saat ingestion. Tanpa
 * menampilkannya, angka batas itu hanya ada di dalam database.
 */
export function SensorTypesPanel({
  types,
  onChanged,
}: {
  types: UseApiState<SensorTypeItem[]>;
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
                {types.data.map((type: SensorTypeItem) => (
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
