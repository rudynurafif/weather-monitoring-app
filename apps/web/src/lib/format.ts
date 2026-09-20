/**
 * Konversi waktu ke WIB.
 *
 * INILAH SATU-SATUNYA tempat di seluruh sistem tempat timezone berubah. API
 * selalu mengirim UTC dengan akhiran Z; di sini dan hanya di sini ia menjadi
 * waktu Jakarta. Kalau konversi ini tersebar ke banyak komponen, cepat atau
 * lambat akan ada satu tempat yang lupa dan menampilkan waktu tujuh jam meleset.
 */

const TIME_ZONE = process.env.NEXT_PUBLIC_DISPLAY_TZ ?? 'Asia/Jakarta';

const dateTimeFormatter = new Intl.DateTimeFormat('id-ID', {
  timeZone: TIME_ZONE,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const timeFormatter = new Intl.DateTimeFormat('id-ID', {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
});

const dayFormatter = new Intl.DateTimeFormat('id-ID', {
  timeZone: TIME_ZONE,
  day: '2-digit',
  month: 'short',
});

/** "21 Sep 2026, 14.05 WIB" */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return `${dateTimeFormatter.format(new Date(iso))} WIB`;
}

/** "14.05" — untuk sumbu chart rentang 24 jam. */
export function formatTime(iso: string): string {
  return timeFormatter.format(new Date(iso));
}

/** "21 Sep" — untuk sumbu chart rentang panjang. */
export function formatDay(iso: string): string {
  return dayFormatter.format(new Date(iso));
}

/**
 * Label sumbu yang menyesuaikan rentang.
 *
 * Menampilkan tanggal pada chart 24 jam hanya menghabiskan tempat, dan
 * menampilkan jam pada chart 30 hari membuat labelnya bertabrakan.
 */
export function axisLabel(iso: string, rangeHours: number): string {
  return rangeHours <= 48 ? formatTime(iso) : formatDay(iso);
}

/** "3 menit lalu" */
export function relativeMinutes(minutes: number | null): string {
  if (minutes === null) return 'belum pernah';
  if (minutes < 1) return 'baru saja';
  if (minutes < 60) return `${minutes} menit lalu`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;

  return `${Math.floor(hours / 24)} hari lalu`;
}

export function formatNumber(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return value.toLocaleString('id-ID', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Warna dan label status koneksi, dipakai seragam di semua halaman. */
export function connectivityStyle(connectivity: string): { label: string; className: string } {
  switch (connectivity) {
    case 'ONLINE':
      return { label: 'Online', className: 'bg-emerald-100 text-emerald-800 ring-emerald-600/20' };
    case 'SILENT':
      return { label: 'Diam', className: 'bg-amber-100 text-amber-800 ring-amber-600/20' };
    case 'OFFLINE':
      return { label: 'Offline', className: 'bg-red-100 text-red-800 ring-red-600/20' };
    default:
      return { label: 'Belum ada data', className: 'bg-slate-100 text-slate-600 ring-slate-500/20' };
  }
}
