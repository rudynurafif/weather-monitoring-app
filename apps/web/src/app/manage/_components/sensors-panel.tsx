'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { Modal } from '@/components/modal';
import { Pagination } from '@/components/pagination';
import type {
  DeviceOverview,
  Paginated,
  PaginationMeta,
  SensorListItem,
  SensorTypeItem,
} from '@/types';
import { CreateSensorForm } from './create-sensor-form';
import { SensorActions } from './sensor-actions';
import { SensorTypesPanel } from './sensor-types-panel';

export function SensorsPanel() {
  const [reloadToken, setReloadToken] = useState(0);
  const [managing, setManaging] = useState<SensorListItem | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [typeFilter, setTypeFilter] = useState('');
  const [page, setPage] = useState(1);

  const sensorTypes = useApi<SensorTypeItem[]>(
    async () => (await apiFetch<SensorTypeItem[]>('/sensor-types')).data,
    [reloadToken],
  );

  const sensors = useApi<Paginated<SensorListItem>>(
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
                {sensors.data.rows.map((sensor: SensorListItem) => (
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
