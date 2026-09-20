# Dokumentasi API

Dokumentasi interaktif (Swagger) tersedia di **http://localhost:3001/docs** saat stack berjalan.
Berkas ini memuat kontrak JSON lengkap yang diminta Bagian F beserta penjelasan tiap field.

---

## 1. Ketentuan umum

### Envelope response

Setiap response — sukses maupun gagal — memakai bentuk yang sama, sehingga klien cukup memeriksa satu field (`success`) untuk bercabang.

**Sukses:**

```json
{
  "success": true,
  "data": { },
  "meta": {
    "request_id": "7e92b9e8-16ff-44da-8918-eb395afe7622",
    "timestamp": "2026-09-21T03:15:00.000Z"
  }
}
```

**Gagal:**

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Request tidak valid",
    "details": [
      { "field": "batch[2].readings[0].v", "code": "INVALID_VALUE", "message": "v harus berupa angka" }
    ]
  },
  "meta": {
    "request_id": "7e92b9e8-16ff-44da-8918-eb395afe7622",
    "timestamp": "2026-09-21T03:15:00.000Z"
  }
}
```

| Field | Arti |
|---|---|
| `success` | Satu-satunya field yang perlu diperiksa untuk bercabang |
| `data` | Isi response. Bentuknya berbeda per endpoint |
| `error.code` | **Machine-readable.** Inilah yang boleh dijadikan pegangan logika klien |
| `error.message` | Untuk dibaca manusia. **Jangan pernah di-parse** — kalimatnya bisa berubah kapan saja |
| `error.details` | Kesalahan per-field pada kegagalan validasi. Opsional |
| `meta.request_id` | Penelusuran. Sama dengan header `X-Request-Id`; sertakan saat melaporkan masalah |
| `meta.timestamp` | Selalu UTC dengan akhiran `Z` |

### Timestamp

Semua timestamp dalam **UTC**, format ISO 8601 dengan akhiran `Z`. Konversi ke WIB hanya dilakukan di frontend saat render. Satu pengecualian dijelaskan di `GET /readings/summary`.

### Autentikasi

| Jenis klien | Header |
|---|---|
| Device (endpoint `/ingest/*`) | `X-Device-Key: <key_id>.<secret>` |
| User dashboard | `Authorization: Bearer <jwt>` — **belum diberlakukan**, lihat catatan di README |

### Kode error

| Kode | HTTP | Kapan |
|---|---|---|
| `VALIDATION_FAILED` | 422 | Payload tidak lolos validasi bentuk |
| `MALFORMED_JSON` | 400 | JSON rusak |
| `BATCH_TOO_LARGE` | 413 | Jumlah record melebihi `MAX_BATCH_SIZE` |
| `UNKNOWN_SENSOR_TYPE` | 422 / 404 | Kunci sensor tidak terdaftar di master data |
| `INVALID_TIME_RANGE` | 422 | `from` ≥ `to`, atau rentang melebihi batas |
| `UNAUTHENTICATED` | 401 | Header kredensial tidak ada |
| `INVALID_DEVICE_CREDENTIAL` | 401 | Kredensial salah, dicabut, atau kedaluwarsa |
| `DEVICE_NOT_REGISTERED` | 404 | Device sudah dihapus |
| `DEVICE_NOT_ACTIVE` | 403 | Device berstatus `DECOMMISSIONED` |
| `DEVICE_MISMATCH` | 403 | `device_id` di payload bukan milik kredensial yang dipakai |
| `NOT_FOUND` | 404 | Resource tidak ada |
| `ALREADY_EXISTS` | 409 | Kode device atau nomor seri sudah dipakai |
| `INVALID_STATUS_TRANSITION` | 409 | Perpindahan status tidak diizinkan |
| `SENSOR_ALREADY_INSTALLED` | 409 | Sensor masih terpasang, atau slot sudah terisi |
| `SENSOR_NOT_INSTALLED` | 404 | Sensor tidak sedang terpasang di device tersebut |
| `RATE_LIMIT_EXCEEDED` | 429 | Melewati kuota per device |
| `SERVICE_UNAVAILABLE` | 503 | Database tidak terjangkau; **kirim ulang nanti** |
| `INTERNAL_ERROR` | 500 | Kesalahan tak terduga |

---

## 2. Daftar endpoint

### Ingestion — dipanggil device

| Method | Path | Keterangan |
|---|---|---|
| POST | `/api/v1/ingest/telemetry` | Satu payload pembacaan |
| POST | `/api/v1/ingest/telemetry/batch` | Banyak payload sekaligus (data buffered) |
| POST | `/api/v1/ingest/heartbeat` | Status device tanpa data sensor |

### Device management

| Method | Path |
|---|---|
| POST | `/api/v1/devices` |
| GET | `/api/v1/devices` — filter `status`, `location_id`, `q`; pagination `page`, `per_page` |
| GET | `/api/v1/devices/silent?minutes=15` |
| GET | `/api/v1/devices/{id}` |
| PATCH | `/api/v1/devices/{id}` |
| DELETE | `/api/v1/devices/{id}` |
| POST | `/api/v1/devices/{id}/credentials/rotate` |
| GET | `/api/v1/devices/{id}/health` |

### Sensor management

| Method | Path |
|---|---|
| GET / POST | `/api/v1/sensor-types` |
| GET / POST | `/api/v1/sensors` |
| PATCH / DELETE | `/api/v1/sensors/{id}` |
| POST | `/api/v1/devices/{id}/sensors` — pasang sensor |
| DELETE | `/api/v1/devices/{id}/sensors/{sensorId}` — lepas sensor |
| GET / POST | `/api/v1/sensors/{id}/calibrations` |

### Query — dipakai frontend

| Method | Path |
|---|---|
| GET | `/api/v1/devices/{id}/readings/latest` |
| GET | `/api/v1/readings` — `device_id`, `sensor_type`, `from`, `to`, `interval`, `agg` |
| GET | `/api/v1/readings/summary` — `device_id`, `from`, `to` |
| GET | `/api/v1/dashboard/overview` |

### Operasional

| Method | Path | Keterangan |
|---|---|---|
| GET | `/healthz` | Di luar prefix `/api/v1`, tanpa envelope — dipakai docker healthcheck |
| GET | `/docs` | Swagger UI |

---

## 3. Payload dari device (F.1 — spesifikasi dari soal)

Format ini **tidak diubah**. Backend yang menyesuaikan diri.

```json
{
  "device_id": "WS-GRT-001",
  "fw": "1.4.2",
  "ts": 1757308800,
  "seq": 10432,
  "battery_v": 3.92,
  "rssi": -71,
  "readings": [
    { "s": "temp_air", "v": 27.4 },
    { "s": "humidity", "v": 82.1 },
    { "s": "rain_counter", "v": 1043 }
  ]
}
```

Satu tambahan yang **opsional dan tidak memecah firmware lama**: field `s` boleh diberi akhiran channel, misalnya `"temp_air:1"`, untuk device yang membawa dua sensor bertipe sama. Tanpa akhiran berarti channel 0.

---

## 4. Response ingestion (F.2.1)

### 4.1 Sukses penuh — `200 OK`

```json
{
  "success": true,
  "data": {
    "accepted": 7,
    "duplicated": 0,
    "rejected": 0,
    "errors": [],
    "device_time_range": { "from": "2026-09-21T03:00:00.000Z", "to": "2026-09-21T03:00:00.000Z" }
  },
  "meta": { "request_id": "...", "timestamp": "..." }
}
```

| Field | Arti |
|---|---|
| `accepted` | Jumlah **baris pembacaan** yang benar-benar masuk. Bukan jumlah payload — satu payload berisi 7 sensor menghasilkan 7 baris |
| `duplicated` | Baris yang bentrok dengan data yang sudah ada. **Bukan error** |
| `rejected` | Baris yang ditolak, rinciannya di `errors` |
| `errors` | Kosong bila tidak ada penolakan |
| `device_time_range` | Rentang `device_time` yang diproses; berguna bagi device untuk memastikan batch-nya sampai utuh |

### 4.2 Sukses sebagian — `207 Multi-Status`

Batch berisi 10 payload; 8 diterima, 2 duplikat, dan satu sensor tidak dikenal:

```json
{
  "success": true,
  "data": {
    "accepted": 8,
    "duplicated": 2,
    "rejected": 1,
    "errors": [
      {
        "index": 4,
        "sensor": "soil_moisture",
        "code": "UNKNOWN_SENSOR_TYPE",
        "message": "Tipe sensor \"soil_moisture\" belum terdaftar di master data"
      }
    ],
    "device_time_range": { "from": "2026-09-21T01:00:00.000Z", "to": "2026-09-21T01:09:00.000Z" }
  },
  "meta": { "request_id": "...", "timestamp": "..." }
}
```

| Field | Arti |
|---|---|
| `errors[].index` | Posisi record di dalam array `batch` **sebagaimana device mengirimnya** — bukan posisi setelah server mengurutkannya |
| `errors[].sensor` | Kunci sensor yang bermasalah; `null` bila masalahnya di tingkat record |
| `errors[].code` | Machine-readable |

Yang penting di sini: **status tetap 2xx.** Satu sensor asing tidak membatalkan enam pembacaan sah di sebelahnya, dan device menerima konfirmasi sehingga berhenti mengulang.

### 4.3 Gagal validasi — `422 Unprocessable Entity`

Dikembalikan hanya bila **seluruh** record ditolak:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Seluruh record dalam payload ditolak",
    "details": [
      {
        "field": "batch[0]",
        "code": "TIMESTAMP_TOO_FAR_IN_FUTURE",
        "message": "device_time 2026-09-23T03:00:00.000Z lebih maju dari waktu server sekitar 48 jam; jam device perlu disinkronkan"
      }
    ]
  },
  "meta": { "request_id": "...", "timestamp": "..." }
}
```

### 4.4 Heartbeat — `200 OK`

```json
{
  "success": true,
  "data": {
    "device_time": "2026-09-21T03:02:00.000Z",
    "server_time": "2026-09-21T03:02:01.421Z"
  },
  "meta": { "request_id": "...", "timestamp": "..." }
}
```

Kedua waktu dikembalikan supaya device bisa **mengoreksi jamnya sendiri** dengan membandingkan keduanya.

---

## 5. CRUD device (F.2.2)

### 5.1 Membuat device — `POST /api/v1/devices`

**Request:**

```json
{
  "device_code": "WS-GRT-004",
  "name": "Stasiun Cuaca Garut Selatan",
  "location_id": "3f1a...",
  "firmware_version": "1.4.2"
}
```

| Field | Wajib | Catatan |
|---|---|---|
| `device_code` | ya | Huruf kapital, angka, tanda hubung. Inilah nilai yang dikirim device di payload |
| `name` | ya | Nama yang dibaca manusia |
| `location_id` | tidak | UUID lokasi yang sudah terdaftar |
| `firmware_version` | tidak | Diperbarui sendiri saat device mulai mengirim |

**Response `201 Created`:**

```json
{
  "success": true,
  "data": {
    "id": "6c472b1a-4cc7-40d9-b3ee-5fd564773048",
    "device_code": "WS-GRT-004",
    "name": "Stasiun Cuaca Garut Selatan",
    "status": "PROVISIONED",
    "location": { "id": "3f1a...", "name": "Garut Kota", "latitude": -7.214, "longitude": 107.9, "altitude_m": 717 },
    "last_seen_at": null,
    "created_at": "2026-09-21T03:00:00.000Z",
    "credential": {
      "key_id": "a1b2c3d4e5f60004",
      "device_key": "a1b2c3d4e5f60004.wsk_8Hn2...redacted",
      "warning": "Simpan device_key sekarang juga. Nilai ini tidak akan pernah ditampilkan lagi; kalau hilang, satu-satunya jalan adalah rotasi kredensial."
    }
  },
  "meta": { "request_id": "...", "timestamp": "..." }
}
```

`credential.device_key` adalah **satu-satunya kemunculan** nilai itu sepanjang hidup kredensial. Yang tersimpan di database hanya `SHA-256(secret + pepper)`.

### 5.2 Daftar device — `GET /api/v1/devices?status=ACTIVE&page=1&per_page=20`

```json
{
  "success": true,
  "data": [
    {
      "id": "6c472b1a-...",
      "device_code": "WS-GRT-001",
      "name": "Stasiun Cuaca Garut Kota",
      "status": "ACTIVE",
      "location": { "name": "Garut Kota", "altitude_m": 717 },
      "last_seen_at": "2026-09-21T03:01:00.000Z"
    }
  ],
  "meta": {
    "pagination": { "page": 1, "per_page": 20, "total": 3, "total_pages": 1 },
    "request_id": "...",
    "timestamp": "..."
  }
}
```

Info pagination diletakkan di `meta`, bukan di `data`, supaya `data` selalu berupa array murni dan klien tidak perlu membongkar bentuk yang berbeda-beda per endpoint.

### 5.3 Detail device — `GET /api/v1/devices/{id}`

```json
{
  "success": true,
  "data": {
    "id": "6c472b1a-...",
    "device_code": "WS-GRT-001",
    "name": "Stasiun Cuaca Garut Kota",
    "status": "ACTIVE",
    "location": { "name": "Garut Kota", "latitude": -7.214, "longitude": 107.9, "altitude_m": 717 },
    "last_seen_at": "2026-09-21T03:01:00.000Z",
    "last_battery_v": 3.92,
    "last_rssi": -71,
    "status_history": [
      { "from_status": "PROVISIONED", "to_status": "ACTIVE", "reason": "Telemetri pertama diterima", "changed_at": "2026-08-15T02:00:00.000Z" }
    ],
    "sensors": [
      { "installation_id": "9a1c...", "sensor_id": "77bd...", "serial_number": "TEMP_AIR-001", "sensor_type": "temp_air", "unit": "°C", "channel": 0, "installed_at": "2026-08-15T01:00:00.000Z" }
    ],
    "credentials": [
      { "key_id": "a1b2c3d4e5f60001", "secret_preview": "wsk_dev_gar...", "created_at": "...", "last_used_at": "...", "expires_at": null }
    ]
  },
  "meta": { "request_id": "...", "timestamp": "..." }
}
```

`secret_preview` hanya beberapa karakter awal: cukup untuk membedakan beberapa kredensial di UI, terlalu pendek untuk mempersempit tebakan terhadap 256 bit sisanya.

### 5.4 Menghapus device — `DELETE /api/v1/devices/{id}`

```json
{
  "success": true,
  "data": { "id": "6c472b1a-...", "deleted": true, "historical_data_retained": true },
  "meta": { "request_id": "...", "timestamp": "..." }
}
```

`historical_data_retained` dicantumkan eksplisit supaya tidak ada keraguan: ini soft delete, data historis tetap utuh.

---

## 6. CRUD sensor, pemasangan, dan kalibrasi (F.2.3)

### 6.1 Tipe sensor — `POST /api/v1/sensor-types`

```json
{
  "key": "soil_moisture",
  "display_name": "Kelembapan Tanah",
  "unit": "%",
  "min_valid": 0,
  "max_valid": 100,
  "precision": 1,
  "is_cumulative": false,
  "is_circular": false
}
```

| Field | Arti |
|---|---|
| `key` | Nilai yang dikirim device di field `s` |
| `min_valid` / `max_valid` | Rentang fisik wajar. Pelanggaran **ditandai**, tidak dibuang |
| `is_cumulative` | `true` untuk pencacah yang hanya naik dan direset saat restart. Wajib disertai `unit_per_count` |
| `unit_per_count` | Konversi satu cacahan ke satuan fisik. `rain_counter`: `0.2` |
| `is_circular` | `true` untuk besaran melingkar seperti arah angin; membuat agregasi memakai rata-rata vektor |

Menambah tipe sensor **tidak memerlukan perubahan skema sama sekali** — konsekuensi langsung dari format narrow.

### 6.2 Memasang sensor — `POST /api/v1/devices/{id}/sensors`

**Request:**

```json
{ "sensor_id": "77bd...", "channel": 0, "installed_at": "2026-09-21T00:00:00Z", "notes": "Pemasangan awal" }
```

**Response `201`:**

```json
{
  "success": true,
  "data": {
    "installation_id": "9a1c...",
    "device_id": "6c472b1a-...",
    "sensor_id": "77bd...",
    "sensor_type": "temp_air",
    "channel": 0,
    "installed_at": "2026-09-21T00:00:00.000Z"
  },
  "meta": { "request_id": "...", "timestamp": "..." }
}
```

`channel` membedakan dua sensor bertipe sama pada satu device — misalnya suhu dalam dan luar ruangan.

### 6.3 Melepas sensor — `DELETE /api/v1/devices/{id}/sensors/{sensorId}`

```json
{
  "success": true,
  "data": {
    "installation_id": "9a1c...",
    "removed_at": "2026-09-21T03:00:00.000Z",
    "historical_data_retained": true
  },
  "meta": { "request_id": "...", "timestamp": "..." }
}
```

Baris pemasangan **ditutup**, bukan dihapus. Data yang sudah tersimpan tetap menunjuk pemasangan itu.

### 6.4 Kalibrasi — `POST /api/v1/sensors/{id}/calibrations`

**Request:**

```json
{ "offset": 0.3, "scale": 1.0, "effective_from": "2026-09-21T00:00:00Z", "notes": "Kalibrasi ulang lapangan" }
```

**Response `201`:**

```json
{
  "success": true,
  "data": {
    "id": "c3f1...",
    "sensor_id": "77bd...",
    "offset": 0.3,
    "scale": 1.0,
    "effective_from": "2026-09-21T00:00:00.000Z",
    "effective_to": null,
    "applies_to": "Hanya pembacaan dengan device_time mulai dari effective_from. Data lama TIDAK dihitung ulang; nilai mentahnya tetap tersimpan sehingga perhitungan ulang masih mungkin dilakukan kapan saja."
  },
  "meta": { "request_id": "...", "timestamp": "..." }
}
```

Rumusnya `nilai = mentah × scale + offset`. Kalibrasi yang sedang berlaku otomatis ditutup pada `effective_from` yang baru, sehingga masa berlakunya tidak pernah tumpang tindih — dijaga exclusion constraint di database.

---

## 7. Response time-series (F.2.4)

### 7.1 Kenapa format kolom terpisah

Bentuk yang lazim (array of object) mengulang nama field di setiap elemen:

```json
[{ "t": "...", "v": 27.4 }, { "t": "...", "v": 27.6 }]
```

Pada 5.000 titik, pengulangan itu saja menghabiskan puluhan kilobyte untuk teks yang isinya sama. Format kolom memangkasnya sekitar **60%** dan langsung cocok dengan bentuk yang dibutuhkan pustaka chart:

```json
{
  "success": true,
  "data": {
    "series": {
      "device_id": "6c472b1a-...",
      "sensor_type": "temp_air",
      "unit": "°C",
      "precision": 1,
      "channel": 0,
      "interval": "1h",
      "agg": "avg",
      "from": "2026-09-14T00:00:00.000Z",
      "to": "2026-09-21T00:00:00.000Z",
      "point_count": 164
    },
    "columns": ["t", "v", "min", "max", "count", "count_good"],
    "points": [
      ["2026-09-14T00:00:00.000Z", 18.0, 16.8, 19.5, 12, 12],
      ["2026-09-14T01:00:00.000Z", 17.6, 16.4, 18.9, 12, 11]
    ]
  },
  "meta": {
    "interval_requested": "raw",
    "interval_applied": "1h",
    "interval_coarsened": true,
    "source": "reading_aggregate",
    "estimated_points": 168,
    "max_points": 5000,
    "truncated": false,
    "request_id": "...",
    "timestamp": "..."
  }
}
```

| Field | Arti |
|---|---|
| `columns` | Nama kolom, berurutan sama dengan isi tiap elemen `points` |
| `v` | Nilai utama. Untuk sensor kumulatif = jumlah delta (mm hujan); untuk besaran melingkar = arah rata-rata vektor; selebihnya mengikuti parameter `agg` |
| `count` vs `count_good` | Selisihnya adalah ukuran seberapa dipercaya bucket itu |
| `meta.interval_coarsened` | `true` berarti server menaikkan resolusi; data yang diterima **bukan** resolusi yang diminta |
| `meta.truncated` | `true` berarti batas `max_points` tersentuh dan deretnya terpotong |

Untuk `interval=raw`, kolomnya berbeda — `["t", "v", "flags"]`, dengan `flags` berupa array nama quality flag yang sudah diterjemahkan server:

```json
["2026-09-20T09:35:00.000Z", null, ["SENSOR_ERROR"]]
```

Klien tidak perlu menghitung bit sendiri: arti bitmask bisa berubah, sedangkan nama flag adalah kontrak.

### 7.2 Nilai terkini — `GET /api/v1/devices/{id}/readings/latest`

```json
{
  "success": true,
  "data": [
    {
      "sensor_type": "temp_air",
      "display_name": "Suhu Udara",
      "unit": "°C",
      "channel": 0,
      "device_time": "2026-09-21T03:01:00.000Z",
      "value": 24.0,
      "raw_value": 23.7,
      "delta_value": null,
      "quality_flags": []
    },
    {
      "sensor_type": "rain_counter",
      "display_name": "Curah Hujan (tipping bucket)",
      "unit": "mm",
      "channel": 0,
      "device_time": "2026-09-21T03:01:00.000Z",
      "value": 1547.0,
      "raw_value": 1547,
      "delta_value": 0.4,
      "quality_flags": []
    }
  ],
  "meta": { "request_id": "...", "timestamp": "..." }
}
```

Untuk `rain_counter`, yang bermakna bagi pengguna adalah `delta_value` (curah hujan pada interval terakhir), bukan `value` yang merupakan nilai pencacah. Keduanya dikirim agar klien bisa memilih.

### 7.3 Ringkasan harian — `GET /api/v1/readings/summary`

```json
{
  "success": true,
  "data": [
    {
      "date": "2026-09-20",
      "temp_min": 14.7,
      "temp_max": 23.1,
      "temp_avg": 17.7,
      "humidity_avg": 81.2,
      "rain_mm": 16.8,
      "wind_max": 5.5,
      "reading_count": 2016
    }
  ],
  "meta": { "request_id": "...", "timestamp": "..." }
}
```

> **Satu-satunya pengecualian aturan UTC di seluruh API.** `date` adalah tanggal kalender menurut **WIB**, karena "total hujan hari ini" bagi pengguna berarti tengah malam WIB, bukan tengah malam UTC yang bergeser tujuh jam. Dikirim sebagai `YYYY-MM-DD`, bukan timestamp, supaya tidak ada yang tergoda mengonversinya lagi.

### 7.4 Overview dashboard — `GET /api/v1/dashboard/overview`

```json
{
  "success": true,
  "data": [
    {
      "id": "6c472b1a-...",
      "device_code": "WS-GRT-001",
      "name": "Stasiun Cuaca Garut Kota",
      "status": "ACTIVE",
      "location": { "name": "Garut Kota", "latitude": -7.214, "longitude": 107.9, "altitude_m": 717 },
      "last_seen_at": "2026-09-21T03:01:00.000Z",
      "silent_minutes": 0,
      "connectivity": "ONLINE",
      "battery_v": 3.92,
      "rssi": -71,
      "latest": { "temp_air": 24.6, "humidity": 86.2, "rain_today_mm": 3.8 }
    }
  ],
  "meta": { "request_id": "...", "timestamp": "..." }
}
```

`connectivity` (`ONLINE` / `SILENT` / `OFFLINE` / `NEVER_SEEN`) diturunkan **di server**, supaya semua klien memakai ambang yang sama dan tidak bergantung pada jam perangkat pengguna yang bisa meleset.

---

## 8. Penanganan kasus Bagian F.3

Kedelapan kasus ini diuji sebagai unit test; nama test-nya menyebut nomor kasusnya. Jalankan dengan `npm test --workspace=apps/api`.

| # | Kasus | Perlakuan sistem |
|---|---|---|
| 1 | `ts` di masa depan (jam device maju 2 jam) | **Diterima dengan flag `FUTURE_TIMESTAMP`**, nilainya disimpan apa adanya. `device_time` TIDAK digeser — itu berarti mengubah data berdasarkan tebakan. Di atas 24 jam ke depan, ditolak `422 TIMESTAMP_TOO_FAR_IN_FUTURE` karena jamnya jelas rusak dan akan mengacaukan sumbu semua chart |
| 2 | `temp_air` bernilai `-999` | **Diterima**, `raw_value` tetap `-999` sebagai bukti, `value` di-**null**-kan, flag `SENSOR_ERROR`. Null tidak ikut terhitung dalam `avg()`; kalau −999 tersimpan sebagai angka, ia akan menyeret rata-rata suhu ke bawah diam-diam. Sentinel diperiksa **sebelum** pemeriksaan rentang agar alasan sebenarnya tidak tertutup oleh `OUT_OF_RANGE` |
| 3 | `humidity` bernilai `150` | **Diterima dan disimpan apa adanya**, flag `OUT_OF_RANGE`. Nilai 150% adalah bukti sensor rusak — bukti yang hilang kalau barisnya dibuang. Ia dikecualikan dari agregat statistik lewat `FILTER (WHERE quality_flags & ... = 0)`, sehingga tersimpan tanpa mencemari rata-rata |
| 4 | `rain_counter` turun dari 1043 ke 5 | Terdeteksi sebagai **device restart**. Delta dihitung dari 0, jadi `5 × 0.2 = 1.0 mm`, flag `COUNTER_RESET`. **Tidak pernah menghasilkan hujan negatif.** Hujan yang jatuh di celah restart memang hilang dan tidak bisa dipulihkan — sistem memilih melaporkan kurang daripada mengarang |
| 5 | Payload sama dikirim 3× | Kiriman pertama `accepted=7`, kiriman kedua dan ketiga `accepted=0, duplicated=7`. **Ketiganya dijawab `200`**, bukan error — device mengulang justru karena belum menerima ACK, dan menjawab 4xx akan membuatnya mengulang selamanya. Dedup ditegakkan primary key `(device_id, sensor_type_id, channel, device_time)` lewat `ON CONFLICT DO NOTHING`, **bukan** oleh `seq` yang reset tiap restart |
| 6 | `device_id` tidak terdaftar | Kredensial tidak dikenali → `401 INVALID_DEVICE_CREDENTIAL`, dengan pesan yang sama persis seperti secret salah agar endpoint ini tidak bisa dipakai memetakan `key_id` yang valid. Kredensial sah tetapi `device_id` di payload menunjuk device lain → `403 DEVICE_MISMATCH` |
| 7 | `solar_rad` tidak ada di array `readings` | **Tidak ada baris yang dibuat** untuk sensor itu. Tidak ada `NULL` pengganti, tidak ada baris kosong — ketiadaan data terekam sebagai ketiadaan baris, dan di chart tampak sebagai gap. Sensor lain di payload yang sama tetap diproses normal |
| 8 | Batch berisi 500 record | **Diterima** (batas default `MAX_BATCH_SIZE=500`); 501 ditolak `413 BATCH_TOO_LARGE`. Seluruh batch ditulis lewat **satu** `INSERT` multi-VALUES, bukan 500 insert terpisah. Batch diurutkan menurut `ts` lebih dulu karena perhitungan delta hujan bergantung pada urutan kronologis |
