import { Prisma } from '@prisma/client';
import { UNUSABLE_FLAGS } from '../ingestion/domain/quality-flags';

/**
 * Perhitungan ulang bucket agregat.
 *
 * Inti dari cara sistem ini menangani data terlambat: jalur ingestion tidak
 * pernah menghitung agregat, ia hanya MENANDAI bucket yang tersentuh. Fungsi
 * di sini kemudian menghitung ulang bucket tersebut DARI NOL berdasarkan data
 * mentah yang ada sekarang.
 *
 * Kenapa hitung ulang dan bukan penjumlahan inkremental: agregat inkremental
 * (menambahkan nilai baru ke total lama) lebih cepat, tetapi tidak bisa dibuat
 * idempoten — satu pemrosesan ganda akan menggandakan total curah hujan secara
 * permanen tanpa jejak. Menghitung ulang seluruh bucket selalu menghasilkan
 * angka yang sama berapa kali pun dijalankan. Pada bucket satu jam yang isinya
 * paling banyak 60 baris, biayanya memang murah.
 *
 * SQL-nya ditulis tangan, bukan lewat query builder, karena memakai tiga hal
 * yang tidak punya padanan di Prisma: `time_bucket()` milik TimescaleDB,
 * agregat bersyarat `FILTER (WHERE ...)`, dan rata-rata vektor untuk besaran
 * melingkar.
 */

/** Lebar bucket yang benar-benar dimaterialisasi. Lihat docs/ERD.md §5. */
export type MaterializedBucketWidth = 'HOUR_1' | 'DAY_1';

const BUCKET_INTERVAL: Record<MaterializedBucketWidth, string> = {
  HOUR_1: '1 hour',
  DAY_1: '1 day',
};

/**
 * Menghitung ulang seluruh bucket yang sedang ditandai kotor untuk satu lebar
 * bucket, lalu menghapus penandanya.
 *
 * Penanda dihapus DI DALAM transaksi yang sama dengan penulisan agregat, agar
 * tidak ada keadaan di mana penanda sudah hilang tetapi agregatnya belum
 * sempat ditulis.
 *
 * `LIMIT` membatasi berapa bucket yang dikerjakan sekali jalan supaya satu
 * transaksi tidak pernah berjalan terlalu lama — penting ketika 50 device
 * serentak mengirim data buffered dan menandai ribuan bucket sekaligus.
 */
export function buildRecomputeSql(
  bucketWidth: MaterializedBucketWidth,
  limit: number,
): Prisma.Sql {
  const interval = BUCKET_INTERVAL[bucketWidth];

  return Prisma.sql`
    WITH claimed AS (
      -- Ambil sejumlah penanda tertua. SKIP LOCKED membuat beberapa worker
      -- bisa berjalan bersamaan tanpa saling menunggu dan tanpa mengerjakan
      -- bucket yang sama dua kali.
      SELECT device_id, sensor_type_id, channel, bucket_start
      FROM aggregate_dirty_bucket
      WHERE bucket_width = ${bucketWidth}::bucket_width
      ORDER BY marked_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    ),
    recomputed AS (
      INSERT INTO reading_aggregate (
        device_id, sensor_type_id, channel, bucket_width, bucket_start,
        avg_value, min_value, max_value, sum_delta, last_value,
        sum_sin, sum_cos, count_readings, count_good, computed_at
      )
      SELECT
        r.device_id,
        r.sensor_type_id,
        r.channel,
        ${bucketWidth}::bucket_width,
        time_bucket(${interval}::interval, r.device_time) AS bucket_start,

        -- Statistik HANYA dari pembacaan yang lolos quality check. Nilai di
        -- luar rentang tetap tersimpan di tabel mentah, tetapi tidak boleh
        -- menyeret rata-rata.
        avg(r.value)  FILTER (WHERE (r.quality_flags & ${UNUSABLE_FLAGS}) = 0),
        min(r.value)  FILTER (WHERE (r.quality_flags & ${UNUSABLE_FLAGS}) = 0),
        max(r.value)  FILTER (WHERE (r.quality_flags & ${UNUSABLE_FLAGS}) = 0),

        -- Curah hujan dijumlahkan dari delta, bukan dari nilai pencacah.
        -- delta_value sudah menangani counter reset di jalur ingestion.
        --
        -- Filter quality flag di sini PENTING: delta yang ditandai tidak masuk
        -- akal (lonjakan pencacah ratusan milimeter dalam satu interval,
        -- biasanya akibat pencacah rusak atau device diganti tanpa dicatat)
        -- tidak boleh ikut menggelembungkan total curah hujan. Barisnya tetap
        -- tersimpan sebagai bukti, hanya tidak ikut dijumlahkan.
        sum(r.delta_value) FILTER (WHERE (r.quality_flags & ${UNUSABLE_FLAGS}) = 0),

        -- Nilai terakhir dalam bucket, untuk chart yang menampilkan kondisi
        -- terkini alih-alih rata-rata.
        (array_agg(r.value ORDER BY r.device_time DESC))[1],

        -- Rata-rata besaran MELINGKAR (arah angin) tidak boleh dihitung
        -- aritmetika: rata-rata 350 dan 10 derajat bukan 180. Yang disimpan
        -- adalah jumlah komponen sinus dan kosinusnya; arah rata-ratanya nanti
        -- dihitung sebagai atan2(sum_sin, sum_cos) saat dibaca.
        --
        -- Yang dijumlahkan, bukan dirata-rata, supaya beberapa bucket jam bisa
        -- digabungkan menjadi satu bucket harian tanpa kehilangan ketepatan.
        sum(sin(radians(r.value))) FILTER (
          WHERE st.is_circular AND (r.quality_flags & ${UNUSABLE_FLAGS}) = 0
        ),
        sum(cos(radians(r.value))) FILTER (
          WHERE st.is_circular AND (r.quality_flags & ${UNUSABLE_FLAGS}) = 0
        ),

        -- Selisih kedua angka ini adalah ukuran seberapa dipercaya bucket.
        count(*)::int,
        count(*) FILTER (WHERE (r.quality_flags & ${UNUSABLE_FLAGS}) = 0)::int,

        now()
      FROM sensor_reading r
      JOIN sensor_type st ON st.id = r.sensor_type_id
      JOIN claimed c
        ON  c.device_id      = r.device_id
        AND c.sensor_type_id = r.sensor_type_id
        AND c.channel        = r.channel
        AND c.bucket_start   = time_bucket(${interval}::interval, r.device_time)
      GROUP BY r.device_id, r.sensor_type_id, r.channel, 4, 5
      ON CONFLICT (device_id, sensor_type_id, channel, bucket_width, bucket_start)
      DO UPDATE SET
        avg_value      = EXCLUDED.avg_value,
        min_value      = EXCLUDED.min_value,
        max_value      = EXCLUDED.max_value,
        sum_delta      = EXCLUDED.sum_delta,
        last_value     = EXCLUDED.last_value,
        sum_sin        = EXCLUDED.sum_sin,
        sum_cos        = EXCLUDED.sum_cos,
        count_readings = EXCLUDED.count_readings,
        count_good     = EXCLUDED.count_good,
        computed_at    = EXCLUDED.computed_at
      RETURNING 1
    )
    DELETE FROM aggregate_dirty_bucket d
    USING claimed c
    WHERE d.bucket_width   = ${bucketWidth}::bucket_width
      AND d.device_id      = c.device_id
      AND d.sensor_type_id = c.sensor_type_id
      AND d.channel        = c.channel
      AND d.bucket_start   = c.bucket_start
  `;
}

/**
 * Menandai ulang seluruh bucket yang tersentuh sebuah rentang waktu.
 *
 * Dipakai seeder setelah menulis data historis secara borongan, dan dipakai
 * perintah perhitungan ulang ketika nilai kalibrasi diubah secara surut.
 */
export function buildMarkRangeDirtySql(
  deviceId: string,
  from: Date,
  to: Date,
): Prisma.Sql {
  return Prisma.sql`
    INSERT INTO aggregate_dirty_bucket
      (device_id, sensor_type_id, channel, bucket_width, bucket_start, marked_at)
    SELECT DISTINCT
      r.device_id, r.sensor_type_id, r.channel, w.width,
      time_bucket(w.interval_value, r.device_time), now()
    FROM sensor_reading r
    CROSS JOIN (
      VALUES ('HOUR_1'::bucket_width, INTERVAL '1 hour'),
             ('DAY_1'::bucket_width,  INTERVAL '1 day')
    ) AS w(width, interval_value)
    WHERE r.device_id = ${deviceId}::uuid
      AND r.device_time >= ${from}
      AND r.device_time <= ${to}
    ON CONFLICT DO NOTHING
  `;
}
