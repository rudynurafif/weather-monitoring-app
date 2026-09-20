-- ============================================================================
-- Migrasi ini ditulis tangan, bukan hasil generate Prisma.
--
-- Isinya dua hal yang memang tidak bisa dinyatakan lewat schema.prisma:
--   1. Konversi tabel time-series menjadi hypertable TimescaleDB beserta
--      kebijakan kompresi dan retensinya.
--   2. Exclusion constraint untuk menjaga agar interval waktu (pemasangan
--      sensor dan masa berlaku kalibrasi) tidak pernah saling tumpang tindih.
--
-- Migrasi Prisma dan migrasi tangan sengaja dipisah di dua folder supaya jelas
-- mana yang boleh ditimpa ulang oleh generator dan mana yang tidak.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Extension
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- btree_gist dibutuhkan agar exclusion constraint bisa memakai operator "="
-- pada kolom uuid/integer di dalam index GiST yang sama dengan operator "&&"
-- untuk rentang waktu.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------------
-- 2. Hypertable
-- ---------------------------------------------------------------------------

-- sensor_reading dipartisi per 7 hari.
--
-- Cara memilih ukuran chunk: patokan TimescaleDB adalah chunk yang sedang aktif
-- ditulis (beserta index-nya) sebaiknya muat di sekitar 25% RAM. Dengan beban
-- yang diminta soal -- 50 device x 7 sensor x 1/menit = 504.000 row/hari -- satu
-- chunk 7 hari berisi sekitar 3,5 juta row. Pada lebar row efektif ~100 byte itu
-- berarti ratusan MB per chunk: cukup besar untuk tidak membuat planner
-- kewalahan oleh jumlah chunk, cukup kecil untuk tetap muat di memori.
SELECT create_hypertable(
  'sensor_reading',
  by_range('device_time', INTERVAL '7 days'),
  if_not_exists => TRUE
);

-- Heartbeat jauh lebih ringan (1 row per device per menit, tanpa percabangan
-- sensor), jadi chunk-nya boleh lebih lebar.
SELECT create_hypertable(
  'device_heartbeat',
  by_range('device_time', INTERVAL '30 days'),
  if_not_exists => TRUE
);

-- ---------------------------------------------------------------------------
-- 3. Kompresi
-- ---------------------------------------------------------------------------

-- segmentby dipilih mengikuti kolom yang SELALU dipakai sebagai filter
-- kesetaraan pada query chart (device + tipe sensor + channel). Dengan begitu
-- satu segment terkompresi bisa dilewati seluruhnya ketika filternya tidak
-- cocok, tanpa perlu dibuka.
--
-- orderby device_time DESC membuat nilai-nilai di dalam segment berurutan
-- waktu, sehingga selisih antar nilai kecil dan algoritma delta-of-delta bisa
-- memampatkannya dengan sangat rapat.
ALTER TABLE sensor_reading SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'device_id, sensor_type_id, channel',
  timescaledb.compress_orderby = 'device_time DESC'
);

-- Chunk yang lebih tua dari 30 hari dikompresi otomatis. Angka 30 hari dipilih
-- karena rentang terpanjang yang bisa diminta dashboard adalah 30 hari; data
-- yang lebih tua dari itu praktis hanya dibaca lewat agregat, sehingga penalti
-- baca pada data terkompresi tidak terasa.
SELECT add_compression_policy('sensor_reading', INTERVAL '30 days', if_not_exists => TRUE);

-- ---------------------------------------------------------------------------
-- 4. Retensi
-- ---------------------------------------------------------------------------

-- Pembacaan mentah disimpan 2 tahun, lalu chunk-nya di-DROP. Yang penting:
-- retensi hanya berlaku untuk sensor_reading, TIDAK untuk reading_aggregate.
-- Artinya statistik harian tetap tersimpan selamanya sementara data per-menit
-- yang memakan ruang dibuang -- inilah downsampling yang dimaksud di Bagian C.
--
-- DROP CHUNK jauh lebih murah daripada DELETE: ia hanya membuang tabel fisik,
-- tidak menghasilkan dead tuple, dan tidak memaksa VACUUM membaca ulang
-- seluruh index.
SELECT add_retention_policy('sensor_reading', INTERVAL '730 days', if_not_exists => TRUE);
SELECT add_retention_policy('device_heartbeat', INTERVAL '365 days', if_not_exists => TRUE);

-- ---------------------------------------------------------------------------
-- 5. Exclusion constraint: integritas temporal
-- ---------------------------------------------------------------------------

-- Satu sensor fisik tidak boleh terpasang di dua tempat pada waktu yang sama.
-- Aturan ini ditegakkan di database, bukan hanya di service, karena inilah
-- jaminan yang membuat pertanyaan "sensor mana yang menghasilkan pembacaan ini"
-- punya jawaban tunggal.
--
-- tstzrange(a, b) dengan b NULL berarti rentang tak berhingga ke depan, jadi
-- pemasangan yang masih aktif ikut terlindungi.
ALTER TABLE sensor_installation
  ADD CONSTRAINT sensor_installation_no_overlap
  EXCLUDE USING gist (
    sensor_id WITH =,
    tstzrange(installed_at, removed_at) WITH &&
  );

-- Sebaliknya, satu slot pada device (tipe sensor + channel) juga tidak boleh
-- diisi dua sensor sekaligus. Tanpa constraint ini, pembacaan "temp_air
-- channel 0" pada suatu waktu bisa cocok ke lebih dari satu sensor.
ALTER TABLE sensor_installation
  ADD CONSTRAINT sensor_installation_slot_no_overlap
  EXCLUDE USING gist (
    device_id WITH =,
    sensor_type_id WITH =,
    channel WITH =,
    tstzrange(installed_at, removed_at) WITH &&
  );

-- Masa berlaku kalibrasi pun tidak boleh tumpang tindih: untuk setiap
-- (sensor, waktu) harus ada tepat satu koreksi yang berlaku, sehingga hasil
-- perhitungan ulang selalu deterministik.
ALTER TABLE sensor_calibration
  ADD CONSTRAINT sensor_calibration_no_overlap
  EXCLUDE USING gist (
    sensor_id WITH =,
    tstzrange(effective_from, effective_to) WITH &&
  );

-- ---------------------------------------------------------------------------
-- 6. Index tambahan
-- ---------------------------------------------------------------------------

-- Endpoint /devices/{id}/readings/latest mencari pembacaan TERBARU per tipe
-- sensor. Index ini membuat pencariannya menjadi backward index scan yang
-- berhenti pada baris pertama untuk tiap tipe, bukan memindai rentang waktu.
CREATE INDEX IF NOT EXISTS sensor_reading_latest_idx
  ON sensor_reading (device_id, sensor_type_id, channel, device_time DESC)
  INCLUDE (value, raw_value, quality_flags);

-- Query pemantauan "pembacaan mana yang ditandai bermasalah" hanya menyentuh
-- sebagian kecil data, jadi index-nya dibuat parsial agar tetap ramping.
CREATE INDEX IF NOT EXISTS sensor_reading_flagged_idx
  ON sensor_reading (device_id, device_time DESC)
  WHERE quality_flags <> 0;
