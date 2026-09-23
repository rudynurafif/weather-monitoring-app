# Platform Monitoring Stasiun Cuaca (IoT)

Tes teknis Fullstack Developer — PT Luwes Inovasi Mandiri.

Platform untuk menerima, memvalidasi, menyimpan, mengagregasi, dan memvisualisasikan data dari stasiun cuaca yang tersebar di beberapa lokasi.

| Dokumen | Isi |
|---|---|
| [`JAWABAN.md`](JAWABAN.md) | Pertanyaan desain Bagian A–G dan 8 soal esai |
| [`docs/ERD.md`](docs/ERD.md) | ERD, justifikasi tiap index, perhitungan pertumbuhan data |
| [`docs/DATA-FLOW.md`](docs/DATA-FLOW.md) | Alur data sensor → chart, dan jawaban 6 pertanyaan Bagian D |
| [`docs/API.md`](docs/API.md) | Kontrak JSON lengkap dan penanganan 8 kasus Bagian F.3 |

---

## Menjalankan

```bash
cp .env.example .env
docker compose up --build
```

Satu perintah menjalankan database, migrasi, seeder, backend, dan frontend.

| Layanan | URL |
|---|---|
| Dashboard | http://localhost:3000 |
| API | http://localhost:3001 |
| Swagger | http://localhost:3001/docs |
| Health check | http://localhost:3001/healthz |

Seeder berjalan otomatis saat container API start dan mengisi **25 stasiun, 175 sensor, serta data historis 7 hari (~325.000 pembacaan)** — dashboard langsung berisi tanpa perlu menunggu. Rentang datanya dihitung relatif terhadap waktu dijalankan, jadi data berakhir tepat di saat ini.

Seeder bersifat idempoten dan **melewati pembuatan data historis kalau pembacaan sudah ada**, sehingga menjalankannya ulang tidak menggandakan data — tetapi juga tidak memajukan datanya ke waktu sekarang. Kalau database sudah lama tidak dipakai dan seluruh stasiun tampak diam, kosongkan volume-nya agar data historisnya dibuat ulang:

```bash
docker compose down -v && docker compose up --build
```

Ketinggian kedua puluh lima lokasi sengaja dibuat beragam, dari 3 m di pesisir Indramayu dan Semarang sampai 2.093 m di Dieng, sehingga data contoh memperlihatkan *lapse rate* yang benar: suhu rata-rata turun dari **26,2 °C** di pesisir menjadi **12,6 °C** di Dieng — sekitar 6,5 °C tiap 1.000 m, persis seperti di lapangan.

Tiga stasiun berstatus `PROVISIONED` sengaja **tidak** diberi data historis. Statusnya berarti sudah terdaftar tetapi belum dipasang, jadi memberinya tujuh hari pembacaan justru membuat statusnya berbohong — dan sebagai efek sampingnya dashboard punya contoh nyata untuk *empty state* dan untuk penanda "tidak mengirim data".

Dua stasiun (`WS-IDM-008`, `WS-TGL-018`) sengaja berstatus `MAINTENANCE` agar filter status di halaman manajemen punya sesuatu untuk disaring, dan tiga stasiun membawa anomali yang mewakili kasus Bagian F.3 — sentinel `-999`, kelembapan 150, counter reset, dan satu stasiun yang offline tiga jam sehingga chart-nya memperlihatkan gap.

### Alur peninjauan yang disarankan

Urutan ini menyentuh setiap ketentuan wajib dalam beberapa menit.

| Langkah | Yang dilihat | Ketentuan |
|---|---|---|
| Buka http://localhost:3000 | Kartu per stasiun: lokasi, status, suhu & kelembapan terkini, waktu update. Tepat setelah seeder, seluruh stasiun baru saja mengirim sehingga belum ada yang bertanda diam; biarkan stack menganggur 15 menit tanpa simulator dan penanda "tidak mengirim data lebih dari 15 menit" akan muncul sendiri | G.1 |
| Klik salah satu stasiun | Nilai terkini seluruh sensor, chart suhu+kelembapan dua sumbu, hujan per jam/hari, wind rose. Ganti rentang 24 jam / 7 hari / 30 hari dan perhatikan baris "Resolusi" ikut berubah — interval ditentukan server, bukan browser | G.2, E |
| Buka `WS-BDG-002`, rentang 7 hari | Stasiun ini sengaja offline 3 jam pada hari ke-3: garis chart **putus**, tidak disambung dan tidak dianggap nol | G |
| Buka `WS-GRT-001` | Membawa pembacaan bertanda: sentinel `-999` (nilai di-null-kan, flag `SENSOR_ERROR`) dan kelembapan 150 (disimpan apa adanya, flag `OUT_OF_RANGE`). `WS-CRB-003` membawa counter reset hujan | F.3 |
| Halaman **Manajemen → Device** | Filter status (`WS-IDM-008` berstatus `MAINTENANCE`), pencarian, dan pagination | A.5 |
| Tombol **Tambah device** | Modal registrasi: identitas stasiun plus lokasi baru (koordinat, ketinggian) atau memilih lokasi yang sudah ada. Kredensial device hanya ditampilkan **sekali** setelah dibuat | A.1, A.2 |
| Tombol **Ubah** pada satu baris | Modal ubah: status hanya menawarkan transisi yang diizinkan, ada alasan perubahan, rotasi kredensial, dan soft delete | A.2, A.3, A.5 |
| Tab **Sensor & Kalibrasi** | Tabel **Tipe Sensor** (satuan, rentang valid, presisi, sifat kumulatif/sirkular) yang bisa dibuka, filter per tipe, dan tombol Tambah sensor | B.1, B.5 |
| Tombol **Kelola** pada satu sensor | Modal berisi pemasangan/pelepasan, **riwayat pemasangan** (pernah di device mana saja, sejak kapan sampai kapan), form kalibrasi dengan "berlaku sejak", dan **riwayat kalibrasi** yang rentangnya bersambung tanpa tumpang tindih | B.2, B.3 |
| http://localhost:3001/docs | Swagger seluruh endpoint | E |

Untuk melihat penanganan data yang terlambat dan duplikat secara langsung, jalankan simulator di bawah sambil membuka dashboard.

### Menjalankan device simulator

Seeder mengisi masa lalu; simulator mengisi masa kini.

```bash
# Peragaan lengkap: heartbeat, telemetri, duplikat, lalu data buffered
node tools/simulator/simulator.js --scenario demo

# Pengiriman terus-menerus (Ctrl+C untuk berhenti)
node tools/simulator/simulator.js --scenario normal --interval 60

# Device offline 3 jam lalu mengirim batch dalam urutan acak
node tools/simulator/simulator.js --scenario offline-batch --minutes 180

# Payload identik dikirim 3 kali — bukti idempotensi
node tools/simulator/simulator.js --scenario duplicate
```

Skenario `duplicate` adalah cara tercepat melihat perilaku intinya:

```
[200] kiriman ke-1   WS-GRT-001  accepted=7 duplicated=0 rejected=0
[200] kiriman ke-2   WS-GRT-001  accepted=0 duplicated=7 rejected=0
[200] kiriman ke-3   WS-GRT-001  accepted=0 duplicated=7 rejected=0
```

### Unit test

```bash
npm test --workspace=apps/api
```

60 test yang menutup empat logika wajib: konversi `rain_counter` termasuk counter reset, validasi rentang dan quality flag, dedup/idempotensi, serta penerapan kalibrasi.

### Pengembangan tanpa Docker

Database tetap di dalam Docker, sedangkan backend dan frontend jalan langsung di mesin host.

```bash
cp .env.example .env
docker compose up -d db                       # database saja
npm install
npm run migrate --workspace=apps/api
npm run seed --workspace=apps/api
npm run dev:api                               # http://localhost:3001
npm run dev:web                               # http://localhost:3000
```

> **Kalau mesin Anda sudah punya PostgreSQL sendiri di port 5432** — umum kalau pgAdmin ter-install — ganti `POSTGRES_PORT` menjadi `5433` di `.env` dan sesuaikan port di `DATABASE_URL`, lalu jalankan `docker compose up -d db` sekali lagi. Di Windows, dua proses bisa sama-sama mendengarkan 5432 tanpa saling mengeluh, dan koneksi dari host akan mendarat di PostgreSQL native yang tidak punya role `weather`. Gejalanya `P1000 Authentication failed`, bukan `connection refused`, sehingga mudah disalahartikan sebagai kredensial yang salah. Port di dalam container tetap 5432, jadi `docker compose up` penuh tidak terpengaruh.

`DATABASE_URL` di `.env` memakai `localhost`, dan itu memang yang dibutuhkan di sini: variabel tersebut **hanya** dibaca proses di host — Prisma CLI dan `npm run dev:api`. Container `api` tidak membacanya sama sekali; ia menyusun URL-nya sendiri dari `POSTGRES_*` dengan host `db`, yaitu nama service di jaringan Docker. Nama itu tidak bisa dipetakan dari luar Docker, sehingga `npm run dev:api` dengan `@db:5432` akan berhenti dengan `P1001 Can't reach database server`.

---

## Stack

| Layer | Pilihan | Alasan |
|---|---|---|
| Backend | NestJS 11 (Node 22, TypeScript) | Struktur modular, DI yang membuat unit test mudah, Swagger dari dekorator |
| Database | TimescaleDB 2.30 (PostgreSQL 16) | Hypertable, kompresi, dan retensi untuk beban time-series |
| ORM / migrasi | Prisma 6 | Migrasi ter-versi. Query time-series ditulis raw SQL |
| Frontend | Next.js 15 (App Router) + Recharts + Tailwind 4 | Wajib salah satu Next/Nuxt |
| Deployment | Docker Compose | Seluruh stack satu perintah |

---

## Arsitektur singkat

```
Device ──HTTPS──> Ingestion ──> sensor_reading (hypertable, append-only)
                      │                  │
                      │                  └──> antrean bucket kotor
                      │                              │
                      └──> device.last_seen_at       └──> Worker agregasi
                                                          (tiap 15 detik)
                                                              │
                                                     reading_aggregate
                                                              │
Dashboard <──JSON kolom, UTC── API query <────────────────────┘
```

Enam keputusan yang membentuk seluruh sistem:

**1. Pembacaan disimpan narrow/long**, satu baris per sensor per waktu. Payload device sendiri sudah narrow dan panjangnya berubah-ubah — sensor yang error tidak ikut dikirim. Format wide akan mengubah ketiadaan data menjadi `NULL` yang ambigu, dan menambah tipe sensor akan berarti `ALTER TABLE` pada tabel ratusan juta baris. [Perbandingan lengkap](docs/ERD.md#7-wide-vs-narrow-kenapa-saya-memilih-narrow).

**2. Primary key merangkap kunci idempotensi**: `(device_id, sensor_type_id, channel, device_time)`. Pengiriman ulang bentrok di sana dan di-`DO NOTHING`. **Bukan `seq`** — soal menyebut `seq` reset ke 0 setiap device restart, jadi memakainya sebagai kunci akan menolak data yang sah.

**3. Nilai mentah tidak pernah diubah.** Kalibrasi disimpan sebagai interval berlaku dan hasilnya ditulis ke kolom terpisah. Selama `raw_value` masih ada, keputusan kalibrasi apa pun bisa dihitung ulang.

**4. Kepemilikan sensor adalah interval waktu, bukan kolom yang ditimpa.** Memindahkan sensor membuat baris riwayat baru; baris lama hanya ditutup. Resolusi memakai `device_time`, sehingga data 31 Mei tetap menunjuk device tempat sensornya berada saat itu.

**5. Agregat dihitung ulang dari nol, bukan ditambahkan inkremental.** Ingestion hanya menandai bucket yang tersentuh; worker menghitungnya ulang. Lebih mahal, tetapi idempoten — dan itulah yang membuat data yang terlambat tiga jam otomatis memperbaiki agregat jam yang sudah terlanjur dihitung.

**6. Kebijakan resolusi ada di server.** Permintaan `interval=raw` untuk rentang 7 hari dinaikkan otomatis ke `1h` dan penyesuaiannya dilaporkan di `meta`. Tidak ada cara bagi frontend untuk menarik jutaan baris.

---

## Keputusan & trade-off

| Keputusan | Yang didapat | Yang dibayar |
|---|---|---|
| Hypertable chunk 7 hari | Chunk exclusion: query 24 jam menyentuh 1 dari 52 chunk. Retensi lewat `DROP` chunk, bukan `DELETE` 184 juta row | Bergantung pada extension. Skema tetap jalan di PostgreSQL polos, tetapi tanpa kompresi dan partisi otomatis |
| Tabel agregat + worker, **bukan** continuous aggregate | Penanganan data terlambat eksplisit, idempoten, dan bisa diuji | Menulis dan merawat worker sendiri; agregat bersifat *eventually consistent* dengan jeda beberapa detik |
| `sensor_reading` tanpa foreign key fisik | Tidak ada 5 lookup tambahan per baris pada jalur terpanas, tidak ada penguncian baris induk | Integritas bergantung pada disiplin lapisan aplikasi. Dapat diterima karena hanya ada satu jalan masuk ke tabel itu |
| SHA-256 + pepper untuk secret device | Verifikasi murah pada setiap payload; endpoint ingestion tidak bisa dipakai menghabiskan CPU | Bukan KDF lambat. Aman **hanya karena** secret-nya acak 256 bit — akan salah total untuk password manusia |
| Dedup lewat constraint, bukan cek-lalu-tulis | Tidak ada celah balapan antara dua request bersamaan | Jumlah duplikat hanya diketahui dari selisih, bukan per-baris |
| Rate limit di memori proses | Tanpa dependensi tambahan | Kuota berlaku per instance. Butuh Redis bila dijalankan lebih dari satu instance |
| Data historis seeder per 5 menit | `docker compose up` pertama selesai cepat | Bukan resolusi 1 menit seperti device sungguhan. Simulator tetap mengirim per menit |

---

## Yang belum selesai

Ditulis terbuka; masing-masing disertai rencana penyelesaiannya.

**1. Autentikasi user dashboard belum diberlakukan.** Tabel `user` dengan hash scrypt sudah ada dan seeder membuat akun `admin@weather.local` / `admin12345`, tetapi endpoint pembacaan dan manajemen **masih terbuka tanpa token** agar reviewer bisa langsung membuka dashboard. Ini kesengajaan untuk mempermudah penilaian, bukan desain produksi. Rencana: modul `AuthModule` dengan `POST /auth/login` yang mengeluarkan JWT, `JwtAuthGuard` di seluruh endpoint non-ingestion, dan pemeriksaan peran pada endpoint yang mengubah data. Perkiraan 2–3 jam. Risikonya saya catat juga di [esai keamanan](JAWABAN.md#8-risiko-keamanan-pada-endpoint-ingestion-yang-terbuka-ke-internet-dan-mitigasinya).

**2. Deteksi sensor macet baru berupa tempatnya, belum pelaksananya.** Nilai `STUCK_SENSOR` sudah ada di bitmask quality flag dan query deteksinya sudah dirancang ([esai no. 6](JAWABAN.md#6-bagaimana-mendeteksi-sensor-yang-macet--mengirim-data-terus-tapi-nilainya-identik-selama-6-jam)), tetapi belum ada job periodik yang menjalankannya dan menuliskan flag-nya.

**3. Integration test belum ada.** Yang ada 60 unit test terhadap logika murni dan satu service dengan Prisma tiruan. Idealnya ada juga test end-to-end yang menembak API sungguhan di atas database Testcontainers — terutama untuk membuktikan `ON CONFLICT` dan exclusion constraint benar-benar menegakkan aturannya. Sementara ini, pembuktiannya dilakukan manual lewat device simulator.

**4. Rata-rata arah angin belum dibobot kecepatan.** Rata-rata vektornya sudah benar, tetapi secara ilmiah idealnya setiap arah dibobot kecepatannya — angin 20 m/s dari barat lebih menentukan daripada 0,5 m/s dari timur.

**5. Ingestion MQTT belum ada.** Hanya HTTP. Desainnya sudah memisahkan transport dari pemrosesan, jadi menambahkannya tidak menyentuh lapisan validasi sampai penyimpanan.

**6. Belum ada antrean tahan-mati di depan database.** Bila database down, API menjawab `503` + `Retry-After` dan mengandalkan buffer device — yang sah karena soal menyatakan device memang menyimpan data tertahan, tetapi berarti data hilang bila database mati lebih lama daripada daya tahan buffer. [Rencana perbaikannya](docs/DATA-FLOW.md#d6--kalau-database-down-saat-payload-masuk).

**7. Ekspor CSV, WebSocket/SSE, dan metrics Prometheus** — seluruhnya bonus, tidak dikerjakan.

---

## Asumsi yang saya ambil

1. **`device_id` di payload harus cocok dengan pemilik kredensial.** Soal tidak menyatakannya eksplisit, tetapi tanpa pemeriksaan ini kredensial yang bocor bisa menulis data atas nama stasiun mana pun.
2. **Sentinel error tidak hanya `-999`.** `-9999` ikut dikenali karena lazim dipakai firmware lain dan tidak berada di dalam rentang wajar tipe sensor mana pun di sistem ini.
3. **Timestamp lebih dari 24 jam ke depan ditolak**, sedangkan di bawah itu hanya ditandai. Harus ada batas di suatu tempat; 24 jam cukup longgar untuk jam yang meleset, cukup ketat untuk mencegah titik data tersesat ke masa depan.
4. **Bucket `MINUTE_1` tidak dimaterialisasi.** Pada device yang mengirim tiap menit, jumlah barisnya sama persis dengan data mentah — hanya menggandakan penyimpanan tanpa mempercepat apa pun. Permintaan `interval=1m` dihitung saat diminta.
5. **Batas hari untuk ringkasan kalender memakai WIB**, sedangkan seluruh penyimpanan dan bucket lain memakai UTC. "Total hujan hari ini" bagi pengguna berarti tengah malam WIB.
6. **Tipe sensor hanya bisa ditambah, tidak diubah atau dihapus.** Bagian B.5 menyebut "CRUD tipe sensor", tetapi tabel endpoint di soal sendiri hanya mencantumkan `GET` dan `POST` untuk `/sensor-types`, dan saya mengikuti yang kedua dengan sengaja: mengubah rentang valid sebuah tipe berarti mengubah arti `quality_flags` pada baris-baris yang sudah tersimpan. Pembacaan yang dulu ditandai `OUT_OF_RANGE` tidak akan ikut berubah, sehingga flag lama dan rentang baru jadi saling bertentangan tanpa jejak. Kalau rentangnya memang perlu berubah, yang benar adalah membuat tipe baru atau memberi tipe itu versi berlaku-sejak — bukan menimpa barisnya.
7. **Kredensial development di `tools/simulator/devices.json` sengaja di-commit** agar reviewer bisa menjalankan simulator tanpa menyalin secret dari mana-mana. Yang tersimpan di database tetap hanya hash-nya; `.env` tidak pernah di-commit.

---

## Struktur repo

```
.
├── apps/
│   ├── api/                      # Backend NestJS
│   │   ├── prisma/
│   │   │   ├── schema.prisma     # Skema database
│   │   │   ├── migrations/       # Migrasi Prisma + migrasi tangan (hypertable)
│   │   │   └── seed.ts           # Seeder idempoten
│   │   ├── scripts/              # Pembungkus Prisma CLI agar .env root terbaca
│   │   └── src/
│   │       ├── aggregation/      # Worker agregasi + SQL perhitungan ulang
│   │       ├── auth/             # Kredensial dan guard device
│   │       ├── common/           # Envelope, error code, request_id
│   │       ├── devices/          # CRUD device, kredensial, health
│   │       ├── ingestion/        # Jalur ingestion
│   │       │   └── domain/       # Logika murni + unit test
│   │       ├── locations/        # CRUD lokasi pemasangan stasiun
│   │       ├── readings/         # Query time-series + kebijakan resolusi
│   │       └── sensors/          # CRUD sensor, pemasangan, kalibrasi
│   └── web/                      # Frontend Next.js
│       └── src/
│           ├── app/              # Halaman: ikhtisar, detail, manajemen
│           ├── components/       # Chart, modal, dan komponen state
│           └── lib/              # Klien API, format WIB, hook
├── tools/simulator/              # Device simulator
├── docs/                         # ERD, alur data, dokumentasi API
└── docker-compose.yml
```

---

## Estimasi waktu

**Sekitar 5 jam kerja intensif**, dengan urutan yang sengaja mengikuti bobot penilaian:

| Tahap | Waktu |
|---|---|
| Scaffold, Docker, kontrak API | ~30 menit |
| Skema database, hypertable, constraint temporal | ~40 menit |
| ERD, diagram alur data, jawaban desain A–D | ~35 menit |
| Jalur ingestion | ~50 menit |
| Seeder, mesin agregasi, simulator | ~45 menit |
| Unit test | ~30 menit |
| Query API, CRUD device & sensor | ~60 menit |
| Frontend | ~50 menit |
| README, JAWABAN, dokumentasi API | ~40 menit |

Dokumen desain dikerjakan **sebelum** kodenya, bukan sesudah. Bagian C dan D bernilai 30 poin dan menentukan seluruh bentuk kode setelahnya — mengerjakannya belakangan berarti mendokumentasikan apa yang sudah terlanjur dibuat, bukan merancangnya.
