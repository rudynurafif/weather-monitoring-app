'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { axisLabel, formatDateTime, formatNumber } from '@/lib/format';

export interface SeriesPoint {
  t: string;
  v: number | null;
}

/**
 * Menyisipkan titik kosong pada lubang data.
 *
 * Pertanyaan wajib Bagian G: bagaimana menampilkan gap ketika device offline
 * tiga jam — garis putus, nol, atau interpolasi?
 *
 * Jawaban yang dipakai di sini: **garis putus**.
 *
 *  - Menggambar NOL akan terbaca sebagai "suhunya memang 0 °C". Itu bukan
 *    ketiadaan data, melainkan data yang salah.
 *  - Interpolasi mengarang nilai yang tidak pernah diukur. Untuk cuaca itu
 *    berbahaya: garis mulus melintasi masa mati perangkat akan menyembunyikan
 *    fakta bahwa stasiunnya sempat berhenti bekerja — justru informasi yang
 *    paling perlu diketahui operator.
 *
 * API hanya mengirim titik yang benar-benar ada, sehingga lubangnya tidak
 * terlihat oleh pustaka chart dan garisnya akan tersambung begitu saja. Fungsi
 * ini menyisipkan satu titik bernilai null di setiap lubang, dan
 * `connectNulls={false}` yang memutus garisnya.
 */
export function insertGaps(points: SeriesPoint[], expectedIntervalMs: number): SeriesPoint[] {
  if (points.length < 2) return points;

  // Ambang 1,8x jarak normal: cukup longgar untuk menoleransi keterlambatan
  // biasa, cukup ketat untuk menangkap satu pengiriman yang benar-benar hilang.
  const gapThreshold = expectedIntervalMs * 1.8;
  const result: SeriesPoint[] = [];

  for (let i = 0; i < points.length; i += 1) {
    result.push(points[i]);

    const next = points[i + 1];
    if (!next) continue;

    const distance = new Date(next.t).getTime() - new Date(points[i].t).getTime();
    if (distance > gapThreshold) {
      result.push({
        t: new Date(new Date(points[i].t).getTime() + expectedIntervalMs).toISOString(),
        v: null,
      });
    }
  }

  return result;
}

interface ChartFrameProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  height?: number;
}

function ChartFrame({ title, subtitle, children, height = 280 }: ChartFrameProps) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <header className="mb-3">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
      </header>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          {children as React.ReactElement}
        </ResponsiveContainer>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Suhu & kelembapan, dua sumbu
// ---------------------------------------------------------------------------

export function TempHumidityChart({
  temperature,
  humidity,
  rangeHours,
  intervalMs,
}: {
  temperature: SeriesPoint[];
  humidity: SeriesPoint[];
  rangeHours: number;
  intervalMs: number;
}) {
  // Kedua deret digabung menurut waktu agar satu tooltip bisa menampilkan
  // keduanya sekaligus.
  const humidityByTime = new Map(humidity.map((point) => [point.t, point.v]));

  const rows = insertGaps(temperature, intervalMs).map((point) => ({
    t: point.t,
    temp: point.v,
    humidity: point.v === null ? null : (humidityByTime.get(point.t) ?? null),
  }));

  return (
    <ChartFrame
      title="Suhu & Kelembapan"
      subtitle="Dua sumbu: suhu (°C) di kiri, kelembapan (%) di kanan. Garis terputus berarti data tidak ada."
    >
      <LineChart data={rows} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis
          dataKey="t"
          tickFormatter={(value: string) => axisLabel(value, rangeHours)}
          tick={{ fontSize: 11, fill: '#64748b' }}
          minTickGap={40}
        />
        <YAxis
          yAxisId="temp"
          tick={{ fontSize: 11, fill: '#64748b' }}
          domain={['dataMin - 2', 'dataMax + 2']}
        />
        <YAxis
          yAxisId="humidity"
          orientation="right"
          domain={[0, 100]}
          tick={{ fontSize: 11, fill: '#64748b' }}
        />
        <Tooltip
          labelFormatter={(label: unknown) => formatDateTime(String(label))}
          formatter={(value: unknown, name: unknown) => [
            value === null || value === undefined ? 'tidak ada data' : formatNumber(Number(value), 1),
            String(name),
          ]}
          contentStyle={{ fontSize: 12 }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line
          yAxisId="temp"
          type="monotone"
          dataKey="temp"
          name="Suhu (°C)"
          stroke="#ea580c"
          dot={false}
          strokeWidth={2}
          // Inilah yang membuat lubang data tampak sebagai garis putus.
          connectNulls={false}
        />
        <Line
          yAxisId="humidity"
          type="monotone"
          dataKey="humidity"
          name="Kelembapan (%)"
          stroke="#2563eb"
          dot={false}
          strokeWidth={2}
          connectNulls={false}
        />
      </LineChart>
    </ChartFrame>
  );
}

// ---------------------------------------------------------------------------
// Curah hujan
// ---------------------------------------------------------------------------

export function RainChart({
  points,
  rangeHours,
  granularity,
}: {
  points: SeriesPoint[];
  rangeHours: number;
  granularity: 'jam' | 'hari';
}) {
  // Hujan TIDAK diberi penyisipan gap: batang yang absen sudah berarti tidak
  // ada data, dan batang bernilai nol berarti tidak turun hujan. Keduanya
  // memang perlu dibedakan secara visual, dan ketiadaan batang melakukannya.
  const rows = points.map((point) => ({ t: point.t, mm: point.v ?? 0 }));
  const total = rows.reduce((sum, row) => sum + row.mm, 0);

  return (
    <ChartFrame
      title={`Curah Hujan per ${granularity}`}
      subtitle={`Total ${formatNumber(total, 1)} mm pada rentang ini. Dikonversi dari rain_counter: 1 jungkitan = 0,2 mm.`}
    >
      <BarChart data={rows} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis
          dataKey="t"
          tickFormatter={(value: string) => axisLabel(value, rangeHours)}
          tick={{ fontSize: 11, fill: '#64748b' }}
          minTickGap={30}
        />
        <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
        <Tooltip
          labelFormatter={(label: unknown) => formatDateTime(String(label))}
          formatter={(value: unknown) => [`${formatNumber(Number(value), 1)} mm`, 'Curah hujan']}
          contentStyle={{ fontSize: 12 }}
        />
        <Bar dataKey="mm" name="Curah hujan (mm)" fill="#0ea5e9" radius={[2, 2, 0, 0]} />
      </BarChart>
    </ChartFrame>
  );
}

// ---------------------------------------------------------------------------
// Wind rose
// ---------------------------------------------------------------------------

const COMPASS_SECTORS = [
  'U', 'UTL', 'TL', 'TTL', 'T', 'TG', 'TG-S', 'SSG',
  'S', 'SBD', 'BD', 'BBD', 'B', 'BL', 'BL-U', 'UBL',
];

/**
 * Wind rose: seberapa sering angin datang dari tiap arah, dan seberapa kencang.
 *
 * Arah dibagi menjadi 16 sektor selebar 22,5°. Yang penting dan mudah salah:
 * sektor utara membentang dari 348,75° sampai 11,25°, yaitu MELINTASI angka 0.
 * Karena itu pembagiannya memakai `Math.round(derajat / 22.5) % 16`, bukan
 * pembagian biasa yang akan memotong tepat di 0° dan memecah utara menjadi dua
 * sektor terpisah.
 */
export function WindRose({
  directions,
  speeds,
}: {
  directions: SeriesPoint[];
  speeds: SeriesPoint[];
}) {
  const speedByTime = new Map(speeds.map((point) => [point.t, point.v]));

  const buckets = COMPASS_SECTORS.map((label) => ({
    sector: label,
    frekuensi: 0,
    totalSpeed: 0,
  }));

  for (const point of directions) {
    if (point.v === null) continue;

    const index = Math.round(((point.v % 360) + 360) % 360 / 22.5) % 16;
    buckets[index].frekuensi += 1;
    buckets[index].totalSpeed += speedByTime.get(point.t) ?? 0;
  }

  const rows = buckets.map((bucket) => ({
    sector: bucket.sector,
    frekuensi: bucket.frekuensi,
    rata_kecepatan:
      bucket.frekuensi === 0 ? 0 : Math.round((bucket.totalSpeed / bucket.frekuensi) * 10) / 10,
  }));

  const hasData = rows.some((row) => row.frekuensi > 0);

  if (!hasData) {
    return (
      <ChartFrame title="Mawar Angin" subtitle="Belum ada data arah angin pada rentang ini.">
        <RadarChart data={rows}>
          <PolarGrid stroke="#e2e8f0" />
          <PolarAngleAxis dataKey="sector" tick={{ fontSize: 10, fill: '#94a3b8' }} />
        </RadarChart>
      </ChartFrame>
    );
  }

  return (
    <ChartFrame
      title="Mawar Angin"
      subtitle="Sebaran arah datangnya angin dalam 16 sektor, beserta rata-rata kecepatannya."
      height={320}
    >
      <RadarChart data={rows} outerRadius="72%">
        <PolarGrid stroke="#e2e8f0" />
        <PolarAngleAxis dataKey="sector" tick={{ fontSize: 10, fill: '#64748b' }} />
        <PolarRadiusAxis angle={90} tick={{ fontSize: 10, fill: '#94a3b8' }} />
        <Tooltip
          formatter={(value: unknown, name: unknown) => [
            name === 'Frekuensi'
              ? `${Number(value)} pengamatan`
              : `${formatNumber(Number(value), 1)} m/s`,
            String(name),
          ]}
          contentStyle={{ fontSize: 12 }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Radar
          name="Frekuensi"
          dataKey="frekuensi"
          stroke="#7c3aed"
          fill="#7c3aed"
          fillOpacity={0.35}
        />
        <Radar
          name="Rata-rata kecepatan (m/s)"
          dataKey="rata_kecepatan"
          stroke="#059669"
          fill="#059669"
          fillOpacity={0.2}
        />
      </RadarChart>
    </ChartFrame>
  );
}
