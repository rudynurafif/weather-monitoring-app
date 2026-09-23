'use client';

import Link from 'next/link';
import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useApi } from '@/lib/use-api';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { Modal } from '@/components/modal';
import { Pagination } from '@/components/pagination';
import type { DeviceListItem, Paginated } from '@/types';
import { CreateDeviceForm } from './create-device-form';
import { EditDeviceForm } from './edit-device-form';

const STATUSES = ['', 'PROVISIONED', 'ACTIVE', 'MAINTENANCE', 'DECOMMISSIONED'];

export function DevicesPanel() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<DeviceListItem | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const devices = useApi<Paginated<DeviceListItem>>(
    async () => {
      const result = await apiFetch<DeviceListItem[]>('/devices', {
        query: { page, per_page: 10, status: status || undefined, q: q || undefined },
      });

      return {
        rows: result.data,
        pagination: result.meta.pagination as Paginated<DeviceListItem>['pagination'],
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
                {devices.data.rows.map((device: DeviceListItem) => (
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
