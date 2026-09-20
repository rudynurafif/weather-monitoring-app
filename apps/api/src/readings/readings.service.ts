import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { ApiException } from '../common/errors/api.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { describeFlags, UNUSABLE_FLAGS } from '../ingestion/domain/quality-flags';
import { PrismaService } from '../prisma/prisma.service';
import { ReadingAgg, ReadingInterval, type QueryReadingsDto } from './dto/query-readings.dto';
import {
  estimatePointCount,
  MAX_POINTS,
  MAX_RANGE_DAYS,
  resolveInterval,
} from './interval-policy';

/**
 * Lapisan query yang dipakai dashboard.
 *
 * Seluruh query time-series di sini ditulis sebagai SQL mentah, bukan lewat
 * Prisma. Alasannya bukan selera: `time_bucket()`, agregat bersyarat
 * `FILTER (WHERE ...)`, `DISTINCT ON`, dan `LATERAL` tidak punya padanan di
 * query builder, dan justru keempatnya yang membuat query-query ini murah.
 */
@Injectable()
export class ReadingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Deret waktu untuk chart.
   *
   * Formatnya KOLOM TERPISAH (`columns` + `points` berupa array of array),
   * bukan array of object. Pada 5.000 titik, mengulang nama field di setiap
   * elemen menghabiskan puluhan kilobyte hanya untuk teks yang sama berulang;
   * bentuk kolom memangkasnya sekitar 60% dan langsung cocok dengan bentuk
   * yang diminta pustaka chart.
   */
  async queryReadings(dto: QueryReadingsDto) {
    const from = new Date(dto.from);
    const to = new Date(dto.to);

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
      throw new ApiException(
        ErrorCode.INVALID_TIME_RANGE,
        'Parameter "from" harus lebih awal daripada "to" dan keduanya harus ISO 8601 yang valid',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const rangeMs = to.getTime() - from.getTime();

    if (rangeMs > MAX_RANGE_DAYS * 86_400_000) {
      throw new ApiException(
        ErrorCode.INVALID_TIME_RANGE,
        `Rentang maksimum ${MAX_RANGE_DAYS} hari; pecah permintaan menjadi beberapa bagian`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const sensorType = await this.prisma.sensorType.findUnique({ where: { key: dto.sensor_type } });
    if (!sensorType) {
      throw new ApiException(
        ErrorCode.UNKNOWN_SENSOR_TYPE,
        `Tipe sensor "${dto.sensor_type}" tidak terdaftar`,
        HttpStatus.NOT_FOUND,
      );
    }

    // Server yang memutuskan resolusinya, bukan klien. Lihat interval-policy.ts.
    const interval = resolveInterval(dto.interval, rangeMs);

    const isRaw = interval.applied === ReadingInterval.RAW;

    // Dua jalur ini sengaja dipisah, bukan disatukan lewat operator ternary.
    // Bentuk barisnya memang berbeda — mentah membawa quality flag per
    // pembacaan, teragregasi membawa statistik bucket — dan memaksakan
    // keduanya ke satu tipe gabungan hanya akan menyamarkan perbedaan itu.
    let columns: string[];
    let points: unknown[][];

    if (isRaw) {
      const rows = await this.queryRaw(dto, sensorType.id, from, to);

      columns = ['t', 'v', 'flags'];
      points = rows.map((row) => [
        row.t.toISOString(),
        round(row.value, sensorType.precision),
        // Bitmask diterjemahkan di server. Klien tidak seharusnya menghitung
        // bit sendiri — artinya bisa berubah, kodenya tidak.
        row.quality_flags ? describeFlags(row.quality_flags) : [],
      ]);
    } else {
      const rows = await this.queryAggregated(dto, sensorType.id, from, to, interval.applied);

      columns = ['t', 'v', 'min', 'max', 'count', 'count_good'];
      points = rows.map((row) => [
        row.t.toISOString(),
        this.primaryValue(row, dto.agg, sensorType),
        round(row.min_value, sensorType.precision),
        round(row.max_value, sensorType.precision),
        row.count_readings ?? 0,
        row.count_good ?? 0,
      ]);
    }

    return {
      data: {
        series: {
          device_id: dto.device_id,
          sensor_type: sensorType.key,
          unit: sensorType.unit,
          precision: sensorType.precision,
          channel: dto.channel,
          interval: interval.applied,
          agg: isRaw ? null : dto.agg,
          from: from.toISOString(),
          to: to.toISOString(),
          point_count: points.length,
        },
        columns,
        points,
      },
      meta: {
        interval_requested: interval.requested,
        interval_applied: interval.applied,
        // Diberi tahu terbuka supaya klien tahu data yang diterima bukan
        // resolusi yang diminta.
        interval_coarsened: interval.coarsened,
        source: isRaw ? 'sensor_reading' : 'reading_aggregate',
        estimated_points: estimatePointCount(rangeMs, interval.applied),
        max_points: MAX_POINTS,
        truncated: points.length >= MAX_POINTS,
      },
    };
  }

  /** Pembacaan mentah, dilayani langsung dari hypertable. */
  private queryRaw(dto: QueryReadingsDto, sensorTypeId: number, from: Date, to: Date) {
    return this.prisma.$queryRaw<
      Array<{ t: Date; value: number | null; quality_flags: number }>
    >(Prisma.sql`
      SELECT device_time AS t, value, quality_flags
      FROM sensor_reading
      WHERE device_id = ${dto.device_id}::uuid
        AND sensor_type_id = ${sensorTypeId}
        AND channel = ${dto.channel}
        AND device_time >= ${from}
        AND device_time <= ${to}
      ORDER BY device_time
      LIMIT ${MAX_POINTS}
    `);
  }

  /**
   * Deret teragregasi.
   *
   * `1h` dan `1d` dibaca dari tabel agregat yang sudah dihitung worker.
   * `1m` TIDAK dimaterialisasi — jumlah barisnya akan sama persis dengan data
   * mentah ketika device mengirim tiap menit, jadi memateralisasinya hanya
   * menggandakan penyimpanan tanpa mempercepat apa pun. Ia dihitung saat
   * diminta, dan itu murah karena kebijakan resolusi hanya mengizinkannya
   * untuk rentang paling lebar tiga hari.
   */
  private queryAggregated(
    dto: QueryReadingsDto,
    sensorTypeId: number,
    from: Date,
    to: Date,
    interval: ReadingInterval,
  ) {
    type Row = {
      t: Date;
      avg_value: number | null;
      min_value: number | null;
      max_value: number | null;
      sum_delta: number | null;
      sum_sin: number | null;
      sum_cos: number | null;
      count_readings: number | null;
      count_good: number | null;
    };

    if (interval === ReadingInterval.MINUTE_1) {
      return this.prisma.$queryRaw<Row[]>(Prisma.sql`
        SELECT
          time_bucket('1 minute'::interval, device_time) AS t,
          avg(value) FILTER (WHERE (quality_flags & ${UNUSABLE_FLAGS}) = 0) AS avg_value,
          min(value) FILTER (WHERE (quality_flags & ${UNUSABLE_FLAGS}) = 0) AS min_value,
          max(value) FILTER (WHERE (quality_flags & ${UNUSABLE_FLAGS}) = 0) AS max_value,
          sum(delta_value) FILTER (WHERE (quality_flags & ${UNUSABLE_FLAGS}) = 0) AS sum_delta,
          sum(sin(radians(value))) FILTER (WHERE (quality_flags & ${UNUSABLE_FLAGS}) = 0) AS sum_sin,
          sum(cos(radians(value))) FILTER (WHERE (quality_flags & ${UNUSABLE_FLAGS}) = 0) AS sum_cos,
          count(*)::int AS count_readings,
          count(*) FILTER (WHERE (quality_flags & ${UNUSABLE_FLAGS}) = 0)::int AS count_good
        FROM sensor_reading
        WHERE device_id = ${dto.device_id}::uuid
          AND sensor_type_id = ${sensorTypeId}
          AND channel = ${dto.channel}
          AND device_time >= ${from}
          AND device_time <= ${to}
        GROUP BY 1
        ORDER BY 1
        LIMIT ${MAX_POINTS}
      `);
    }

    const bucketWidth = interval === ReadingInterval.HOUR_1 ? 'HOUR_1' : 'DAY_1';

    return this.prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT
        bucket_start AS t,
        avg_value, min_value, max_value, sum_delta, sum_sin, sum_cos,
        count_readings, count_good
      FROM reading_aggregate
      WHERE device_id = ${dto.device_id}::uuid
        AND sensor_type_id = ${sensorTypeId}
        AND channel = ${dto.channel}
        AND bucket_width = ${bucketWidth}::bucket_width
        AND bucket_start >= ${from}
        AND bucket_start <= ${to}
      ORDER BY bucket_start
      LIMIT ${MAX_POINTS}
    `);
  }

  /**
   * Memilih nilai utama satu bucket.
   *
   * Tiga jenis besaran diperlakukan berbeda, dan itu ditentukan oleh flag di
   * master data tipe sensor — bukan oleh nama sensornya:
   *
   *  - **Kumulatif** (`rain_counter`): selalu jumlah delta. Rata-rata nilai
   *    pencacah tidak punya arti fisik sama sekali.
   *  - **Melingkar** (`wind_dir`): arah rata-rata dihitung dari komponen
   *    vektornya, atan2(sum_sin, sum_cos). Rata-rata aritmetika 350° dan 10°
   *    menghasilkan 180°, yaitu arah yang berlawanan dengan yang sebenarnya.
   *  - Sisanya mengikuti parameter `agg`.
   */
  private primaryValue(
    row: {
      avg_value: number | null;
      min_value: number | null;
      max_value: number | null;
      sum_delta: number | null;
      sum_sin: number | null;
      sum_cos: number | null;
    },
    agg: ReadingAgg,
    sensorType: { isCumulative: boolean; isCircular: boolean; precision: number },
  ): number | null {
    if (sensorType.isCumulative) {
      return round(row.sum_delta, sensorType.precision);
    }

    if (sensorType.isCircular) {
      if (row.sum_sin === null || row.sum_cos === null) {
        return null;
      }
      const degrees = (Math.atan2(row.sum_sin, row.sum_cos) * 180) / Math.PI;
      return Math.round((degrees + 360) % 360);
    }

    switch (agg) {
      case ReadingAgg.MIN:
        return round(row.min_value, sensorType.precision);
      case ReadingAgg.MAX:
        return round(row.max_value, sensorType.precision);
      case ReadingAgg.SUM:
        return round(row.sum_delta, sensorType.precision);
      default:
        return round(row.avg_value, sensorType.precision);
    }
  }

  /**
   * Nilai terkini seluruh sensor pada satu device.
   *
   * `DISTINCT ON` membuat PostgreSQL berhenti pada baris pertama untuk setiap
   * kombinasi (tipe sensor, channel) — memakai index
   * `sensor_reading_latest_idx` secara mundur, bukan memindai rentang waktu.
   *
   * Batas 30 hari dipasang agar query tetap menyentuh sedikit chunk. Device
   * yang sudah lebih dari sebulan senyap memang tidak punya "nilai terkini"
   * yang layak ditampilkan.
   */
  async latestForDevice(deviceId: string) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        key: string;
        display_name: string;
        unit: string;
        precision: number;
        channel: number;
        device_time: Date;
        value: number | null;
        raw_value: number;
        delta_value: number | null;
        quality_flags: number;
      }>
    >(Prisma.sql`
      SELECT DISTINCT ON (r.sensor_type_id, r.channel)
        st.key, st.display_name, st.unit, st.precision,
        r.channel, r.device_time, r.value, r.raw_value, r.delta_value, r.quality_flags
      FROM sensor_reading r
      JOIN sensor_type st ON st.id = r.sensor_type_id
      WHERE r.device_id = ${deviceId}::uuid
        AND r.device_time > now() - INTERVAL '30 days'
      ORDER BY r.sensor_type_id, r.channel, r.device_time DESC
    `);

    return rows.map((row) => ({
      sensor_type: row.key,
      display_name: row.display_name,
      unit: row.unit,
      channel: row.channel,
      device_time: row.device_time.toISOString(),
      value: round(row.value, row.precision),
      raw_value: row.raw_value,
      // Untuk sensor kumulatif, inilah angka yang bermakna: curah hujan pada
      // interval terakhir, bukan nilai pencacahnya.
      delta_value: round(row.delta_value, row.precision),
      quality_flags: describeFlags(row.quality_flags),
    }));
  }

  /**
   * Ringkasan harian.
   *
   * Satu-satunya tempat di seluruh backend yang memakai timezone selain UTC.
   * "Total hujan hari ini" menurut pengguna berarti tengah malam WIB, bukan
   * tengah malam UTC yang bergeser 7 jam. Karena itu pengelompokannya memakai
   * `AT TIME ZONE 'Asia/Jakarta'`, dan pengecualian ini ditulis terbuka di
   * dokumentasi endpoint agar tidak menjadi jebakan diam-diam.
   */
  async dailySummary(deviceId: string, from: Date, to: Date) {
    const displayTz = this.config.get<string>('displayTimezone') ?? 'Asia/Jakarta';

    const rows = await this.prisma.$queryRaw<
      Array<{
        day: Date;
        temp_min: number | null;
        temp_max: number | null;
        temp_avg: number | null;
        humidity_avg: number | null;
        rain_mm: number | null;
        wind_max: number | null;
        reading_count: number;
      }>
    >(Prisma.sql`
      SELECT
        date_trunc('day', r.device_time AT TIME ZONE ${displayTz}) AS day,
        round(min(r.value) FILTER (WHERE st.key = 'temp_air' AND (r.quality_flags & ${UNUSABLE_FLAGS}) = 0)::numeric, 1)::float8 AS temp_min,
        round(max(r.value) FILTER (WHERE st.key = 'temp_air' AND (r.quality_flags & ${UNUSABLE_FLAGS}) = 0)::numeric, 1)::float8 AS temp_max,
        round(avg(r.value) FILTER (WHERE st.key = 'temp_air' AND (r.quality_flags & ${UNUSABLE_FLAGS}) = 0)::numeric, 1)::float8 AS temp_avg,
        round(avg(r.value) FILTER (WHERE st.key = 'humidity' AND (r.quality_flags & ${UNUSABLE_FLAGS}) = 0)::numeric, 1)::float8 AS humidity_avg,
        round(sum(r.delta_value) FILTER (WHERE st.key = 'rain_counter' AND (r.quality_flags & ${UNUSABLE_FLAGS}) = 0)::numeric, 1)::float8 AS rain_mm,
        round(max(r.value) FILTER (WHERE st.key = 'wind_speed' AND (r.quality_flags & ${UNUSABLE_FLAGS}) = 0)::numeric, 1)::float8 AS wind_max,
        count(*)::int AS reading_count
      FROM sensor_reading r
      JOIN sensor_type st ON st.id = r.sensor_type_id
      WHERE r.device_id = ${deviceId}::uuid
        AND r.device_time >= ${from}
        AND r.device_time <= ${to}
      GROUP BY 1
      ORDER BY 1 DESC
    `);

    return rows.map((row) => ({
      // Tanggal kalender menurut WIB. Dikirim sebagai YYYY-MM-DD, bukan
      // timestamp, supaya tidak ada yang tergoda mengonversinya lagi.
      date: row.day.toISOString().slice(0, 10),
      temp_min: row.temp_min,
      temp_max: row.temp_max,
      temp_avg: row.temp_avg,
      humidity_avg: row.humidity_avg,
      rain_mm: row.rain_mm ?? 0,
      wind_max: row.wind_max,
      reading_count: row.reading_count,
    }));
  }

  /**
   * Data halaman utama dashboard: satu baris ringkas per device.
   *
   * Memakai LATERAL JOIN untuk mengambil nilai terkini suhu dan kelembapan
   * tiap device dalam SATU query. Tanpa itu, dashboard berisi 50 device akan
   * memicu 100 query terpisah — persoalan N+1 klasik yang justru paling terasa
   * di halaman yang paling sering dibuka.
   */
  async dashboardOverview() {
    const offlineThresholdMinutes =
      this.config.get<number>('deviceOfflineThresholdMinutes') ?? 15;

    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        device_code: string;
        name: string;
        status: string;
        last_seen_at: Date | null;
        last_battery_v: number | null;
        last_rssi: number | null;
        location_name: string | null;
        latitude: number | null;
        longitude: number | null;
        altitude_m: number | null;
        temp_air: number | null;
        humidity: number | null;
        rain_today_mm: number | null;
      }>
    >(Prisma.sql`
      SELECT
        d.id, d.device_code, d.name, d.status::text AS status,
        d.last_seen_at, d.last_battery_v, d.last_rssi,
        l.name AS location_name,
        l.latitude::float8 AS latitude,
        l.longitude::float8 AS longitude,
        l.altitude_m::float8 AS altitude_m,
        t.value AS temp_air,
        h.value AS humidity,
        rain.total AS rain_today_mm
      FROM device d
      LEFT JOIN location l ON l.id = d.location_id

      LEFT JOIN LATERAL (
        SELECT r.value
        FROM sensor_reading r
        WHERE r.device_id = d.id
          AND r.sensor_type_id = (SELECT id FROM sensor_type WHERE key = 'temp_air')
          AND r.device_time > now() - INTERVAL '30 days'
        ORDER BY r.device_time DESC
        LIMIT 1
      ) t ON TRUE

      LEFT JOIN LATERAL (
        SELECT r.value
        FROM sensor_reading r
        WHERE r.device_id = d.id
          AND r.sensor_type_id = (SELECT id FROM sensor_type WHERE key = 'humidity')
          AND r.device_time > now() - INTERVAL '30 days'
        ORDER BY r.device_time DESC
        LIMIT 1
      ) h ON TRUE

      LEFT JOIN LATERAL (
        SELECT round(sum(r.delta_value) FILTER (WHERE (r.quality_flags & ${UNUSABLE_FLAGS}) = 0)::numeric, 1)::float8 AS total
        FROM sensor_reading r
        WHERE r.device_id = d.id
          AND r.sensor_type_id = (SELECT id FROM sensor_type WHERE key = 'rain_counter')
          AND r.device_time >= date_trunc('day', now() AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta'
      ) rain ON TRUE

      WHERE d.deleted_at IS NULL
      ORDER BY d.device_code
    `);

    const now = Date.now();

    return rows.map((row) => {
      const silentMinutes =
        row.last_seen_at === null
          ? null
          : Math.floor((now - row.last_seen_at.getTime()) / 60_000);

      return {
        id: row.id,
        device_code: row.device_code,
        name: row.name,
        status: row.status,
        location: row.location_name
          ? {
              name: row.location_name,
              latitude: row.latitude,
              longitude: row.longitude,
              altitude_m: row.altitude_m,
            }
          : null,
        last_seen_at: row.last_seen_at ? row.last_seen_at.toISOString() : null,
        silent_minutes: silentMinutes,
        // Status koneksi diturunkan di server, bukan di browser, supaya semua
        // klien memakai ambang yang sama dan tidak bergantung pada jam
        // perangkat pengguna yang bisa saja meleset.
        connectivity: deriveConnectivity(silentMinutes, offlineThresholdMinutes),
        battery_v: row.last_battery_v,
        rssi: row.last_rssi,
        latest: {
          temp_air: round(row.temp_air, 1),
          humidity: round(row.humidity, 1),
          rain_today_mm: row.rain_today_mm ?? 0,
        },
      };
    });
  }
}

/**
 * Tiga tingkat, bukan dua.
 *
 * "SILENT" ada supaya device yang baru melewatkan satu-dua pengiriman tidak
 * langsung dinyatakan mati — jeda jaringan sesaat adalah hal biasa di
 * lapangan, dan alarm yang terlalu cepat berbunyi akan diabaikan orang.
 */
function deriveConnectivity(
  silentMinutes: number | null,
  thresholdMinutes: number,
): 'ONLINE' | 'SILENT' | 'OFFLINE' | 'NEVER_SEEN' {
  if (silentMinutes === null) {
    return 'NEVER_SEEN';
  }
  if (silentMinutes < thresholdMinutes) {
    return 'ONLINE';
  }
  if (silentMinutes < thresholdMinutes * 4) {
    return 'SILENT';
  }
  return 'OFFLINE';
}

function round(value: number | null | undefined, digits: number): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
