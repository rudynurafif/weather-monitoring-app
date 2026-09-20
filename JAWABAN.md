# Jawaban Pertanyaan Desain & Esai

Berisi pertanyaan desain Bagian A, B, C, D, E, G dan soal esai Bagian 5.
Untuk C dan D, jawaban ringkasnya ada di sini dan uraian lengkapnya di [`docs/ERD.md`](docs/ERD.md) serta [`docs/DATA-FLOW.md`](docs/DATA-FLOW.md).

---

## Bagian A — Device Management

### A.2 Bagaimana secret device disimpan?

Kredensial berbentuk dua bagian, dikirim device pada header `X-Device-Key: <key_id>.<secret>`:

| Bagian | Sifat | Disimpan sebagai |
|---|---|---|
| `key_id` | Publik, 16 karakter acak | Plaintext, kolom **unique** |
| `secret` | Rahasia, 32 byte acak (256 bit) | **`SHA-256(secret + pepper)`** — nilai aslinya tidak pernah disimpan |

Empat keputusan di dalamnya:

**1. Kenapa dipecah menjadi `key_id` dan `secret`.** Kalau yang dikirim hanya satu string rahasia, server harus mencari barisnya dengan mencoba mencocokkan hash ke seluruh kredensial yang ada — karena hash tidak bisa dicari terbalik. Dengan `key_id` yang terindeks unik, verifikasi menjadi satu lookup langsung, lalu satu perbandingan hash. Pada 350 request/menit, bedanya antara O(1) dan O(n).

**2. Kenapa SHA-256, bukan bcrypt atau argon2.** Ini justru kebalikan dari aturan menyimpan password. bcrypt sengaja dibuat lambat untuk melawan serangan tebak-kamus terhadap password buatan manusia yang entropinya rendah. Secret device di sini **dibangkitkan acak sepanjang 256 bit** — tidak ada kamus yang bisa menebaknya, sehingga KDF yang lambat tidak menambah keamanan sama sekali. Yang ditambahkannya justru masalah: hashing lambat dijalankan pada setiap payload masuk, dan itu menjadikan endpoint ingestion sasaran empuk untuk kehabisan CPU. Untuk password pengguna dashboard, saya tetap memakai KDF lambat (scrypt) — karena di sana entropinya memang rendah.

**3. Pepper, bukan salt per-baris.** Pepper adalah string acak yang disimpan di **environment variable** (`DEVICE_KEY_PEPPER`), bukan di database. Konsekuensinya: seseorang yang berhasil membuang seluruh isi database tetap tidak bisa memalsukan device, karena ia tidak memegang pepper-nya. Salt per-baris tidak diperlukan di sini sebab secret-nya sudah unik dan acak, jadi tidak ada risiko rainbow table.

**4. Secret hanya pernah ada satu kali.** Nilai aslinya dikembalikan hanya pada response `POST /devices` dan `POST /devices/{id}/credentials/rotate`, disertai peringatan eksplisit. Setelah itu tidak ada satu pun endpoint yang bisa mengeluarkannya. Yang bisa ditampilkan di UI hanya `secret_prefix` (`wsk_a1b2…`) untuk membedakan beberapa kredensial. Kalau secret hilang, jalan satu-satunya adalah rotasi.

**Perbandingannya waktu-tetap** (`crypto.timingSafeEqual`), supaya lamanya proses tidak membocorkan berapa banyak karakter awal yang sudah benar.

**Rotasi tanpa memutus device.** `POST /credentials/rotate` membuat kredensial baru berstatus `ACTIVE` dan memberi kredensial lama `expires_at = now() + 7 hari`, bukan langsung mencabutnya. Selama masa tenggang itu keduanya diterima. Tanpa ini, device yang kebetulan sedang offline saat rotasi akan terkunci di luar sistem secara permanen — dan justru device yang sering offline itulah yang paling sulit dijangkau teknisi.

### A — Apa yang terjadi pada data historis ketika device di-decommission?

**Data historis dipertahankan seutuhnya.** Yang berubah hanya status device menjadi `DECOMMISSIONED`, yang berakibat: ingestion baru ditolak `403`, seluruh kredensialnya dicabut, dan device tidak lagi muncul di listing default maupun dihitung dalam pemantauan kesehatan. Tidak satu pun baris `sensor_reading` tersentuh.

**Kenapa begitu:**

1. **Data cuaca bernilai justru karena masa lalunya.** "Suhu maksimum di lokasi ini selama lima tahun terakhir" tetap harus terjawab benar sekalipun stasiunnya sudah lama dibongkar. Menghapus data device berarti membuat rata-rata historis dan perbandingan antar tahun berubah setiap kali ada perangkat dipensiunkan.
2. **Pembacaan adalah catatan pengukuran, bukan milik perangkat.** Device hanyalah alat yang kebetulan mencatatnya. Mempensiunkan alatnya tidak membuat pengukurannya tidak pernah terjadi.
3. **Skemanya memang dirancang untuk itu.** `sensor_reading` tidak punya foreign key ke `device` (lihat [ERD §4](docs/ERD.md#4-kenapa-sensor_reading-tidak-punya-foreign-key-fisik)), jadi tidak ada `ON DELETE CASCADE` yang bisa tanpa sengaja menghapus jutaan baris. `device` sendiri memakai soft delete dengan alasan yang sama.

**Alternatif yang saya pertimbangkan dan tolak:**

| Pendekatan | Kenapa tidak |
|---|---|
| Hard delete device + cascade ke pembacaannya | Menghancurkan seri historis, dan tidak bisa dibatalkan kalau ternyata keliru. |
| Pindahkan ke tabel arsip | Memecah data yang sama ke dua tempat; setiap query historis harus menyatukannya kembali. Chunk terkompresi TimescaleDB sudah memberi manfaat yang sama tanpa memecah tabel. |
| Ekspor ke CSV lalu hapus | Data yang keluar dari database berhenti bisa di-query. Masuk akal hanya untuk data di luar masa retensi, bukan sebagai konsekuensi pensiunnya sebuah perangkat. |

**Yang tetap berlaku:** retention policy. Data device yang dipensiunkan ikut terhapus setelah 2 tahun seperti data lainnya, sementara ringkasan harian di `reading_aggregate` tetap tersimpan. Jadi yang dipertahankan selamanya adalah statistiknya, bukan seluruh data per-menitnya.

### A — Bagaimana membedakan "device mati" dengan "device hidup tapi jaringan putus"?

**Sejujurnya, pada saat kejadian keduanya tidak bisa dibedakan dengan pasti.** Dari sudut pandang server, dua-duanya tampak persis sama: tidak ada paket yang datang. Yang bisa dilakukan sistem adalah (a) memperkirakan mana yang lebih mungkin dari bukti tidak langsung, dan (b) memastikannya secara retroaktif begitu device muncul kembali. Sistem ini melakukan keduanya, dan tidak berpura-pura yakin sebelum buktinya ada.

**Indikator pada saat kejadian** — dari metadata kesehatan yang ikut disimpan:

| Bukti | Lebih mengarah ke |
|---|---|
| `last_battery_v` menurun tajam pada jam-jam terakhir sebelum senyap | **Mati** — daya habis |
| `last_rssi` memburuk bertahap (mis. −71 → −95) lalu senyap | **Jaringan putus** — sinyal menghilang lebih dulu |
| Senyap mendadak dengan baterai dan RSSI yang masih sehat | Tidak dapat disimpulkan — bisa listrik putus, bisa perangkat keras rusak |
| Device lain di lokasi yang sama ikut senyap pada saat bersamaan | **Gangguan di lokasi** (listrik/jaringan), bukan kerusakan satu perangkat |

**Pemastian retroaktif** — inilah bukti yang menentukan. Ketika device muncul kembali dan mengirim batch buffered-nya, isi batch itu menjawab pertanyaannya:

- Buffer **berisi data yang menutupi seluruh masa senyap** → device hidup sepanjang waktu itu, hanya tidak bisa mengirim. **Jaringan yang putus.**
- Buffer **kosong atau hanya berisi data setelah masa senyap**, dan `uptime_s` pada heartbeat pertama kecil (mis. 40 detik) → device baru saja menyala. **Perangkatnya memang mati.**
- `seq` kembali dari 10432 ke 0 → device restart, menguatkan kesimpulan yang sama.

Karena itu `uptime_s` dan `seq` ikut disimpan meskipun tidak dipakai chart mana pun: keduanya adalah satu-satunya cara membedakan "tidak bisa bicara" dari "tidak sadarkan diri".

**Yang ditampilkan dashboard.** Status disusun bertingkat agar tidak menyatakan lebih dari yang diketahui:

| Status | Aturan |
|---|---|
| `ONLINE` | Ada telemetri atau heartbeat < 15 menit terakhir |
| `SILENT` | Tidak ada kontak 15–60 menit. Ditampilkan sebagai peringatan, belum sebagai kegagalan |
| `OFFLINE` | Tidak ada kontak > 60 menit |
| `RECOVERED_WITH_GAP` | Baru mengirim batch buffered; masa senyapnya ternyata terisi — retroaktif diketahui device tetap hidup |

Dua endpoint terpisah juga membantu memisahkan keduanya di lapangan: `/ingest/heartbeat` tidak membawa data sensor. Device yang hidup dengan sensor rusak tetap terlihat `ONLINE` lewat heartbeat sementara datanya kosong — kondisi yang tidak akan terbedakan kalau satu-satunya bukti kehidupan adalah datangnya data sensor.

---

## Bagian B — Sensor Management

### B — Sensor suhu device A dipindah ke device B pada 1 Juni. Bagaimana data sebelum 1 Juni tetap terhubung ke device A?

**Dijamin oleh dua hal: `device_id` disalin ke setiap baris pembacaan, dan kepemilikan sensor dicatat sebagai interval waktu — bukan sebagai kolom yang ditimpa.**

Yang **tidak** saya lakukan adalah menyimpan relasi kepemilikan hanya di satu tempat, misalnya kolom `sensor.device_id`. Dengan cara itu, memindahkan sensor berarti meng-`UPDATE` kolom tersebut, dan seluruh data historis — yang menemukan device-nya lewat sensor — akan **ikut berpindah ke device B secara surut**. Riwayat berubah hanya karena sebuah perangkat dicabut dari tiangnya.

Yang terjadi di skema ini:

**1. Setiap baris pembacaan membawa `device_id` sendiri.** Nilainya ditetapkan sekali saat ingestion dan tidak pernah diubah lagi. Pembacaan 31 Mei menyimpan `device_id = A` di barisnya sendiri; tidak ada operasi di masa depan yang bisa mengubahnya, karena tabelnya append-only.

**2. Perpindahan dicatat sebagai dua baris interval, bukan satu perubahan.**

```
sensor_installation
┌──────────────┬───────────┬──────────────┬──────────────┐
│ sensor_id    │ device_id │ installed_at │ removed_at   │
├──────────────┼───────────┼──────────────┼──────────────┤
│ TEMP-SN-0042 │ device A  │ 2026-01-15   │ 2026-06-01   │  ← ditutup
│ TEMP-SN-0042 │ device B  │ 2026-06-01   │ NULL         │  ← dibuka
└──────────────┴───────────┴──────────────┴──────────────┘
```

Baris lama tidak dihapus maupun ditimpa; ia hanya **ditutup** dengan mengisi `removed_at`. Sejarahnya tetap utuh dan bisa ditelusuri: sensor ini pernah di device A dari Januari sampai Juni.

**3. Resolusi sensor memakai `device_time`, bukan waktu sekarang.**

```sql
SELECT id, sensor_id FROM sensor_installation
WHERE device_id = $1 AND sensor_type_id = $2 AND channel = $3
  AND installed_at <= $4                            -- $4 = device_time
  AND (removed_at IS NULL OR removed_at > $4)
```

Karena `installed_at <= device_time < removed_at`, data 31 Mei selalu cocok ke baris device A, dan data 2 Juni ke baris device B — berapa kali pun query itu dijalankan, dan tidak peduli berapa kali sensornya berpindah setelah itu.

**4. Database yang menegakkannya.** Exclusion constraint `sensor_installation_no_overlap` membuat PostgreSQL menolak pemasangan di device B kalau pemasangan di device A belum ditutup. Jadi keadaan "satu sensor di dua tempat sekaligus" bukan sesuatu yang dicegah oleh kedisiplinan programmer — melainkan tidak mungkin ada di dalam tabel.

**Sebagai hasilnya, data yang terlambat pun ikut benar.** Kalau pada 3 Juni device A akhirnya mengirim data buffered dari 28 Mei, pencarian di atas memakai `device_time = 28 Mei` dan tetap menemukan pemasangan di device A — walaupun saat itu sensornya sudah lama terpasang di tempat lain.

### B — Nilai kalibrasi diubah hari ini. Apakah data lama ikut berubah?

**Tidak, dan itu disengaja.** Kalibrasi baru dicatat dengan `effective_from = sekarang`, sedangkan kalibrasi sebelumnya ditutup dengan `effective_to = sekarang`. Baris pembacaan yang sudah tersimpan tidak disentuh sama sekali: `raw_value` tetap, `value` tetap, dan `calibration_id` tetap menunjuk kalibrasi yang memang berlaku ketika pengukuran itu terjadi.

```
sensor_calibration
┌──────────────┬────────┬───────┬────────────────┬──────────────┐
│ sensor_id    │ offset │ scale │ effective_from │ effective_to │
├──────────────┼────────┼───────┼────────────────┼──────────────┤
│ TEMP-SN-0042 │  -0.3  │  1.0  │ 2026-01-15     │ 2026-09-21   │  ← ditutup
│ TEMP-SN-0042 │  +0.5  │  1.0  │ 2026-09-21     │ NULL         │  ← berlaku
└──────────────┴────────┴───────┴────────────────┴──────────────┘
```

**Konsekuensi yang saya terima:**

| Konsekuensi | Penjelasan |
|---|---|
| **Ada diskontinuitas di chart** | Pada titik kalibrasi berubah, deret bisa melompat 0,8 °C sekalipun cuacanya tidak berubah. Lompatan ini nyata dan tidak disembunyikan. Frontend menandainya dengan garis vertikal tipis pada titik kalibrasi, sehingga pengguna tahu itu perubahan alat, bukan perubahan cuaca. |
| **Agregat lama tidak ikut berubah** | Rata-rata bulan lalu tetap dihitung dengan kalibrasi lama. Ini justru yang benar: begitulah nilai yang dilaporkan saat itu. |
| **Data lama bisa "salah" menurut pengetahuan hari ini** | Kalau ternyata sensor sudah melenceng sejak tiga bulan lalu dan baru ketahuan sekarang, data tiga bulan itu tetap tersimpan dengan koreksi lama. |

**Kenapa tetap pilihan ini.** Yang disimpan adalah *apa yang terukur dan apa yang diketahui saat itu*. Kalau koreksi hari ini diberlakukan surut, angka yang pernah dilaporkan dalam rapat bulan lalu tidak akan bisa direproduksi — laporan yang sama, dijalankan ulang, menghasilkan angka berbeda tanpa jejak apa pun yang menjelaskan kenapa. Untuk data pengukuran, sifat dapat direproduksi lebih berharga daripada "selalu memakai angka terbaik yang kita tahu".

Selain itu, secara teknis memberlakukan surut berarti meng-`UPDATE` jutaan baris di tabel append-only yang sebagian chunk-nya sudah terkompresi — mahal, dan bertentangan dengan seluruh alasan memilih penyimpanan time-series (lihat esai no. 1).

**Kalau koreksi surut memang diperlukan** — misalnya audit menemukan sensor melenceng sejak Juni — desain ini tetap memungkinkannya, secara eksplisit dan terkendali:

1. Buat baris kalibrasi dengan `effective_from` **di masa lalu** (1 Juni). Exclusion constraint memaksa kalibrasi yang tumpang tindih ditutup lebih dulu, jadi tidak mungkin ada dua koreksi berlaku bersamaan.
2. Jalankan perintah perhitungan ulang, yang membaca `raw_value` — **yang tidak pernah diubah oleh siapa pun** — lalu menghitung ulang `value` dan `delta_value` untuk rentang itu, dan menandai bucket agregatnya kotor.
3. Worker agregasi menyusul memperbaiki ringkasannya.

Inilah alasan sesungguhnya kenapa nilai mentah tidak boleh ditimpa: selama `raw_value` masih ada, keputusan kalibrasi apa pun bisa dibatalkan atau dihitung ulang kapan saja. Begitu nilai mentah ditimpa dengan hasil koreksi, keputusan itu menjadi permanen dan tidak dapat diperiksa lagi.

---

## Bagian C — ERD

Jawaban lengkap beserta perhitungan dan tabel perbandingannya ada di **[`docs/ERD.md`](docs/ERD.md)**. Ringkasnya:

| Pertanyaan | Jawaban singkat |
|---|---|
| Tabel yang tumbuh paling cepat + perhitungannya | `sensor_reading`. 50 × 7 = 350 row/menit → 504.000/hari → **≈ 184 juta row/tahun**, sekitar 58 GB termasuk index. [Rinciannya di §5](docs/ERD.md#5-tabel-mana-yang-tumbuh-paling-cepat). |
| Strategi pertumbuhan + trade-off | **Hypertable** chunk 7 hari sebagai fondasi, dengan kompresi setelah 30 hari, retensi 2 tahun lewat `DROP CHUNK`, dan downsampling ke `reading_aggregate` yang tidak kena retensi. [Tabel trade-off di §6](docs/ERD.md#6-strategi-menghadapi-pertumbuhan). |
| Wide atau narrow | **Narrow**, karena payload device sendiri sudah narrow dan panjangnya berubah-ubah — sensor yang error tidak ikut dikirim, sehingga format wide akan mengubah ketidakhadiran data menjadi `NULL` yang ambigu. [Perbandingan lengkap di §7](docs/ERD.md#7-wide-vs-narrow-kenapa-saya-memilih-narrow). |
| Alasan tiap index | Satu tabel berisi tiap index dan query yang dilayaninya, termasuk satu index yang saya akui paling mahal dan akan jadi yang pertama dibuang. [§3](docs/ERD.md#3-daftar-index-dan-query-yang-dilayaninya). |

---

## Bagian D — Alur Data

Jawaban lengkap keenam pertanyaannya ada di **[`docs/DATA-FLOW.md`](docs/DATA-FLOW.md)**. Ringkasnya:

| # | Pertanyaan | Jawaban singkat |
|---|---|---|
| 1 | Idempotensi | Primary key `(device_id, sensor_type_id, channel, device_time)` + `ON CONFLICT DO NOTHING`. **Bukan `seq`**, karena `seq` reset ke 0 setiap device restart. Tidak memakai dedup window, karena data buffered selalu datang di luar jendela apa pun. |
| 2 | Data terlambat & tidak berurutan | Batch diurutkan menurut `ts` dulu (perhitungan delta hujan bergantung pada urutan). Bucket yang tersentuh ditandai kotor, lalu **dihitung ulang dari nol** — bukan ditambahkan secara inkremental, supaya hasilnya idempoten. |
| 3 | Backpressure | Bulk insert satu perjalanan, batas batch 500, rate limit per device, pool dengan batas antrean yang menolak cepat dengan `503`, dan agregasi di luar jalur request. |
| 4 | `device_time` vs `server_time` | `device_time` menjadi sumbu time-series karena yang dicari pengguna adalah kapan cuacanya begitu. `server_time` disimpan untuk mengukur keterlambatan dan drift. Drift ditandai, **tidak dikoreksi diam-diam**. |
| 5 | Timezone | UTC di device, database, backend, dan response API. Konversi ke WIB **hanya di frontend saat render**. Satu pengecualian: agregat kalender harian memakai batas tengah malam WIB. |
| 6 | Kegagalan database | Jawab `503` + `Retry-After`, **jangan pernah** jawab `2xx` sebelum data tersimpan. Buffer device-lah yang menjadi durabilitas sistem ini; batasnya dan rencana perbaikannya ditulis terbuka. |

---

## Bagian E — API

### E — Bagaimana mencegah response `GET /api/v1/readings` membengkak ketika user meminta rentang 1 tahun?

Tiga lapis pertahanan, dan ketiganya ada di **server**. Kebijakannya terkumpul di [`interval-policy.ts`](apps/api/src/readings/interval-policy.ts) sebagai fungsi murni supaya bisa diuji tanpa database.

**1. Resolusi minimum menurut lebar rentang — ini yang paling menentukan.**

| Rentang diminta | Resolusi paling halus yang diizinkan | Jumlah titik |
|---|---|---|
| ≤ 26 jam | `raw` | ~1.440 |
| ≤ 3 hari | `1m` | ~4.320 |
| ≤ 100 hari | `1h` | ~2.400 |
| > 100 hari | `1d` | ~365 |

Permintaan satu tahun **tidak akan pernah** dilayani dari data mentah, berapa pun nilai `interval` yang dikirim klien. Angka-angka itu diturunkan dari batas 5.000 titik dengan asumsi satu pembacaan per menit.

**2. Batas keras jumlah titik.** `LIMIT 5000` pada setiap query, dan `meta.truncated` memberi tahu klien bila batas itu tersentuh.

**3. Batas lebar rentang.** Permintaan melebihi 400 hari ditolak `422 INVALID_TIME_RANGE` dengan pesan agar dipecah menjadi beberapa bagian.

**Menaikkan, bukan menolak.** Kalau klien meminta resolusi yang lebih halus daripada yang diizinkan, server menaikkannya dan **melaporkan penyesuaiannya** di `meta.interval_applied`, `meta.interval_requested`, dan `meta.interval_coarsened`. Alasannya praktis: chart yang mengubah rentang dari 24 jam ke satu tahun seharusnya tetap menggambar sesuatu, bukan menampilkan error yang memaksa penggunanya menebak parameter yang benar. Yang tidak boleh adalah melakukannya diam-diam — karena itu penyesuaiannya ikut ditampilkan di layar, bukan hanya di response.

Efeknya terukur: permintaan `interval=raw` untuk rentang 7 hari menghasilkan **164 titik dari `reading_aggregate`**, bukan ~12.000 baris dari `sensor_reading`.

### E — Autentikasi device vs autentikasi user dashboard: mekanisme yang sama?

**Berbeda, dan sengaja.** Keduanya menjawab pertanyaan yang berbeda.

| | Device | User dashboard |
|---|---|---|
| Mekanisme | API key: `X-Device-Key: <key_id>.<secret>` | JWT bearer token dari `POST /auth/login` |
| Umur kredensial | Bertahun-tahun, sampai dirotasi | Jam-jaman, lalu login ulang |
| Cara hash | SHA-256 + pepper | scrypt (KDF lambat) |
| Yang dibuktikan | "Perangkat ini yang mengirim" | "Orang ini yang sedang memakai" |
| Pencabutan | Status `REVOKED` di database | Cukup tunggu token kedaluwarsa |
| Kunci rate limit | `device_id` | user + IP |

Tiga alasan yang membuat penyamaan keduanya justru salah:

**Pertama, soal siapa yang memegang.** Kredensial device tertanam di perangkat keras di puncak tiang, tanpa manusia yang mengawasi dan tanpa layar untuk login ulang. Ia harus berumur panjang. Sesi manusia justru sebaliknya: makin pendek makin aman, karena laptop bisa tertinggal dalam keadaan terbuka.

**Kedua, soal biaya verifikasi.** Password manusia entropinya rendah, jadi hashing-nya sengaja dibuat lambat agar mahal ditebak berulang kali. Secret device dibangkitkan acak 256 bit — tidak ada kamus yang bisa menebaknya, sehingga KDF lambat tidak menambah keamanan sama sekali. Yang ditambahkannya justru masalah: verifikasi lambat dijalankan pada **setiap payload masuk**, menjadikan endpoint ingestion sasaran empuk untuk kehabisan CPU.

**Ketiga, soal apa yang boleh dilakukan.** Device hanya boleh menulis telemetri atas nama dirinya sendiri — itu pun diperiksa ulang dengan mencocokkan `device_id` di payload terhadap pemilik kredensialnya. Device tidak punya izin membaca apa pun. User dashboard sebaliknya: boleh membaca seluruh data, dan yang boleh mengubah hanya peran ADMIN/OPERATOR.

> **Catatan jujur tentang yang terpasang sekarang:** lapisan autentikasi user belum saya selesaikan. Tabel `user` beserta hash scrypt-nya sudah ada dan seeder membuat akun admin, tetapi endpoint pembacaan saat ini masih terbuka tanpa token supaya reviewer bisa langsung membuka dashboard. Ini kesengajaan untuk mempermudah penilaian, **bukan desain untuk produksi**, dan ikut tercatat di daftar "belum selesai" di README.

### E — Rancang rate limiting untuk endpoint ingestion

**Kuncinya `device_id`, bukan IP.** Implementasinya di [`device-rate-limit.guard.ts`](apps/api/src/ingestion/device-rate-limit.guard.ts).

Kenapa bukan IP: stasiun cuaca di lapangan lazimnya berada di belakang NAT operator seluler, sehingga puluhan device bisa berbagi satu alamat IP publik. Membatasi per IP berarti satu device yang cerewet menjatuhkan kuota seluruh device di operator yang sama — sementara penyerang cukup berganti IP untuk lolos. Kuncinya harus identitas yang sudah terbukti, dan itu baru diketahui **setelah** autentikasi. Karena itu urutan guard-nya selalu: autentikasi dulu, rate limit sesudahnya.

**Kuotanya** 120 request per menit per device (`INGEST_RATE_LIMIT_PER_MINUTE`), memakai sliding window. Device normal mengirim 1 per menit; batas ini memberi ruang 120 kali lipat untuk pengiriman ulang dan data buffered, sambil tetap menahan device yang firmware-nya rusak dan mengirim tanpa henti.

**Response-nya:**

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 43
X-RateLimit-Limit: 120
X-RateLimit-Remaining: 0
```

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Device WS-GRT-001 melampaui 120 request per menit; coba lagi dalam 43 detik"
  },
  "meta": { "request_id": "...", "timestamp": "..." }
}
```

Header `Retry-After` bukan hiasan: tanpanya, device yang kena limit lazimnya langsung mencoba lagi dan justru memperburuk keadaan.

**Batas yang saya sadari:** hitungannya disimpan di memori proses, jadi kuotanya berlaku per instance API. Kalau kelak dijalankan lebih dari satu instance, hitungannya harus pindah ke penyimpanan bersama — Redis dengan `INCR` + `EXPIRE`. Untuk 50 device dengan satu instance, kompleksitas itu belum terbayar.

### E — Pagination: kenapa offset untuk device, rentang waktu untuk time-series?

Keduanya dipakai, masing-masing di tempat yang cocok.

**Device memakai offset** (`?page=2&per_page=20`). Jumlah device kecil dan stabil, pengguna butuh melihat total dan melompat ke halaman tertentu, dan kelemahan offset — biaya `OFFSET n` yang tumbuh karena database tetap harus melewati n baris, serta baris yang bergeser saat data berubah di tengah penelusuran — tidak terasa pada puluhan baris.

**Time-series memakai batas waktu, yang pada dasarnya cursor.** Klien mengirim `from`/`to`, bukan nomor halaman. Pada tabel 184 juta row, `OFFSET 1000000` memaksa PostgreSQL memindai dan membuang sejuta baris sebelum mengembalikan apa pun. Rentang waktu langsung memanfaatkan urutan index dan *chunk exclusion* hypertable, sehingga biayanya sebanding dengan data yang benar-benar dikembalikan — bukan dengan posisinya di dalam tabel. Data baru yang masuk di tengah penelusuran juga tidak menggeser halaman yang sudah dilewati.

---

## Bagian G — Frontend

### G — Berapa titik data yang wajar dirender dalam satu chart? Bagaimana kalau user memilih rentang 1 tahun?

**Angka praktisnya 500–2.000 titik**, dengan batas keras 5.000 di sisi server.

Alasannya bukan soal kemampuan pustaka chart, melainkan soal layar: chart selebar 1.200 piksel tidak bisa menampilkan lebih dari 1.200 titik tanpa menumpuknya di piksel yang sama. Merender 10.000 titik menghabiskan waktu dan memori untuk menggambar sesuatu yang secara fisik tidak mungkin terlihat. Di atas ~3.000 titik, interaksi hover dan zoom mulai tersendat di perangkat kelas menengah — dan dashboard ini akan dibuka juga dari ponsel.

**Untuk rentang 1 tahun, penanganannya ada di server, bukan di browser:**

1. Chart meminta interval yang sesuai dengan rentangnya (`1d` untuk rentang panjang). Ini keputusan frontend yang sadar — soal melarang menarik data mentah lalu mengagregasinya di browser.
2. Server tetap memaksakan kebijakannya sendiri: permintaan resolusi yang terlalu halus dinaikkan otomatis. Jadi frontend yang salah pun tidak bisa menjatuhkan API.
3. Satu tahun pada resolusi harian = **365 titik**. Nyaman dirender, dan secara ilmiah memang itu resolusi yang bermakna untuk rentang setahun — fluktuasi per menit tidak punya arti pada skala itu.

Halaman detail juga menampilkan resolusi yang benar-benar dipakai beserta jumlah titiknya, sehingga pengguna tahu persis apa yang sedang dilihatnya.

### G — Bagaimana menampilkan gap data ketika device offline 3 jam? Garis putus, nol, atau interpolasi?

**Garis putus.** Implementasinya di [`insertGaps()`](apps/web/src/components/charts.tsx).

| Pilihan | Kenapa tidak |
|---|---|
| **Nol** | Terbaca sebagai "suhunya memang 0 °C" atau "kelembapannya 0%". Itu bukan ketiadaan data, melainkan data yang salah — dan pada chart keduanya tidak bisa dibedakan oleh mata. Akibatnya rata-rata visual ikut tertarik ke bawah. |
| **Interpolasi** | Mengarang nilai yang tidak pernah diukur. Untuk data cuaca ini berbahaya: garis mulus melintasi masa mati perangkat akan **menyembunyikan fakta bahwa stasiunnya sempat berhenti bekerja** — justru informasi yang paling perlu diketahui operator. Gap tiga jam adalah peristiwa, bukan gangguan tampilan yang perlu dirapikan. |
| **Garis putus** | Menunjukkan apa adanya: ada data, lalu tidak ada, lalu ada lagi. Pengguna melihat lubangnya dan tahu harus memeriksa perangkatnya. |

**Cara teknisnya.** API hanya mengirim titik yang benar-benar ada, jadi dari sudut pandang pustaka chart lubang itu tidak terlihat dan garisnya akan tersambung begitu saja — persis seperti interpolasi yang ingin dihindari. Karena itu frontend memeriksa jarak antar titik berurutan; bila jaraknya melebihi 1,8× jarak normal, satu titik bernilai `null` disisipkan di sana, dan `connectNulls={false}` yang memutus garisnya.

Ambang 1,8× dipilih supaya keterlambatan biasa tidak salah dikira gap, sementara satu pengiriman yang benar-benar hilang tetap tertangkap.

**Bar chart hujan diperlakukan berbeda, dan itu disengaja.** Di sana batang bernilai nol berarti "tidak turun hujan" dan batang yang absen berarti "tidak ada data" — dua hal berbeda yang memang perlu terlihat berbeda. Karena itu penyisipan gap tidak diterapkan pada chart hujan.

---

## Soal Esai

### 1. Kenapa data time-series sebaiknya tidak di-`UPDATE`, dan lebih baik append-only?

Karena pembacaan sensor adalah **catatan peristiwa**, bukan keadaan terkini sesuatu. Suhu pukul 10:00 tidak pernah "berubah"; yang ada hanyalah pembacaan baru pada pukul 10:01. Meng-`UPDATE` berarti menyatakan bahwa masa lalu itu keliru, dan sesudahnya tidak ada cara mengetahui nilai aslinya.

Secara teknis, PostgreSQL menerapkan `UPDATE` sebagai hapus-lalu-sisipkan: baris lama menjadi *dead tuple* yang membengkakkan tabel sampai VACUUM membereskannya, dan setiap index yang memuat kolom itu ikut ditulis ulang. Pada tabel 184 juta row yang menerima 350 insert per menit, VACUUM tidak akan pernah mengejar. Pola append-only juga yang membuat kompresi kolom TimescaleDB mungkin — chunk terkompresi sangat mahal untuk diubah per baris, dan tanpa append-only penghematan 10–20× itu hilang.

Yang paling penting: append-only membuat idempotensi mudah. Dengan `ON CONFLICT DO NOTHING`, payload yang dikirim ulang cukup diabaikan. Kalau data boleh diubah, pengiriman ulang harus memutuskan versi mana yang menang — dan pertanyaan itu tidak punya jawaban yang benar.

Koreksi tetap mungkin tanpa `UPDATE`: nilai mentah tidak pernah disentuh, kalibrasi disimpan sebagai interval berlaku, dan hasil koreksinya ditulis ke kolom terpisah yang bisa dihitung ulang kapan saja.

### 2. Apa itu hypertable dan continuous aggregate di TimescaleDB? Kalau hanya PostgreSQL biasa, bagaimana mencapai efek yang sama?

**Hypertable** adalah tabel yang tampak biasa tetapi diam-diam dipartisi otomatis menurut waktu menjadi *chunk*. Di sistem ini satu chunk = 7 hari. Manfaat utamanya *chunk exclusion*: query "24 jam terakhir" hanya menyentuh 1 chunk dari 52, sehingga index yang dipindai selalu kecil tidak peduli seberapa besar tabelnya. Bonusnya, retensi menjadi `DROP` tabel fisik — bukan `DELETE` 184 juta row yang bisa berjam-jam dan meninggalkan dead tuple.

**Continuous aggregate** adalah materialized view yang menyegarkan diri secara **inkremental**: hanya bagian yang datanya berubah yang dihitung ulang, bukan seluruh view. Persis untuk melayani `interval=1h` tanpa menyentuh data mentah.

**Padanannya di PostgreSQL polos:**

| Fitur Timescale | Padanan |
|---|---|
| Hypertable | `PARTITION BY RANGE (device_time)` bawaan PostgreSQL, ditambah `pg_partman` atau cron untuk membuat partisi baru — partisi native tidak dibuat otomatis |
| `time_bucket()` | `date_trunc()`, atau aritmetika epoch untuk bucket yang bukan kelipatan satuan waktu standar |
| Continuous aggregate | Tabel agregat ditambah worker yang meng-`UPSERT`-nya |
| Compression policy | Tidak ada padanan langsung; paling dekat `pg_squeeze` atau memindahkan data lama ke tablespace terkompresi |
| Retention policy | Cron yang menjalankan `DROP TABLE` pada partisi lama |

**Yang saya lakukan di proyek ini adalah campuran yang disengaja.** Hypertable, kompresi, dan retensi memakai TimescaleDB. Tetapi untuk agregat saya **tidak** memakai continuous aggregate, melainkan tabel `reading_aggregate` yang diisi worker sendiri. Alasannya: data terlambat. Dengan tabel sendiri, saya menandai bucket yang tersentuh dan menghitungnya ulang dari nol — perilakunya eksplisit, idempoten, dan bisa saya uji. Dengan continuous aggregate, penanganan data terlambat bergantung pada `refresh_lag` yang harus disetel dengan benar, dan salah setel berarti agregat diam-diam kehilangan data buffered. Saya memilih yang bisa saya pertanggungjawabkan sepenuhnya.

### 3. Perbedaan menghitung rata-rata arah angin dengan rata-rata suhu

Suhu adalah besaran **linier**: 20 °C dan 30 °C rata-ratanya 25 °C, dan angka itu punya arti.

Arah angin adalah besaran **melingkar**: 0° dan 360° menunjuk arah yang sama persis. Rata-rata aritmetika 350° dan 10° menghasilkan 180° — arah yang **berlawanan** dengan kenyataan, padahal kedua pengamatan itu hanya berjarak 20° dan sama-sama menunjuk ke utara.

**Cara yang benar: rata-rata vektor.** Setiap arah diubah menjadi vektor satuan, dijumlahkan, lalu sudutnya diambil kembali:

```
x = Σ cos(θᵢ)
y = Σ sin(θᵢ)
θ̄ = atan2(y, x)   → dinormalkan ke 0–360°
```

Untuk 350° dan 10°: x = cos 350° + cos 10° = 0,985 + 0,985 = 1,970 dan y = sin 350° + sin 10° = −0,174 + 0,174 = 0. Maka atan2(0; 1,970) = 0° — **utara**, yang memang benar.

Di sistem ini, `reading_aggregate` menyimpan `sum_sin` dan `sum_cos`, bukan rata-rata arahnya. Yang disimpan jumlah, bukan rata-rata, supaya beberapa bucket jam bisa digabungkan menjadi satu bucket harian tanpa kehilangan ketepatan — menjumlahkan rata-rata arah sama salahnya dengan merata-ratakan derajat sejak awal. Pemilihan rumusnya tidak di-hardcode per nama sensor, melainkan dikendalikan flag `is_circular` di master data tipe sensor.

Satu hal yang perlu disadari: panjang vektor hasilnya (`√(x²+y²) / n`) adalah ukuran **konsistensi** arah angin. Nilai mendekati 1 berarti angin konsisten dari satu arah; mendekati 0 berarti arahnya berputar-putar sehingga "arah rata-rata" praktis tidak bermakna. Secara ilmiah, idealnya rata-rata arah juga dibobot kecepatan — angin 20 m/s dari barat lebih menentukan daripada 0,5 m/s dari timur. Itu belum saya terapkan dan saya catat sebagai keterbatasan.

### 4. Insert satu per satu vs bulk insert/batching pada 50 device × 7 sensor tiap menit

Bebannya 350 baris per menit, sekitar 6 baris per detik. Angka itu kecil, tetapi cara penulisannya menentukan apakah sistem sanggup menghadapi lonjakan.

**Perkiraan bedanya: 20–100 kali lipat**, dan sumbernya bukan kecepatan database menulis baris.

| Biaya | Insert satu per satu (350×) | Bulk insert (1×) |
|---|---|---|
| Perjalanan jaringan | 350 kali, masing-masing ~0,5–2 ms | 1 kali |
| Parse + plan query | 350 kali | 1 kali |
| Transaksi (BEGIN/COMMIT) | 350 kali, masing-masing menunggu `fsync` WAL | 1 kali |
| Penulisan WAL | 350 catatan terpisah | 1 catatan besar |

Yang paling mahal adalah **`fsync` per transaksi**: menunggu disk benar-benar menulis, biasanya 0,5–5 ms, dan itu waktu tunggu murni yang tidak bisa dipercepat CPU. 350 insert terpisah ≈ 350 × (RTT + fsync) ≈ 350 × 2 ms ≈ **700 ms**. Satu bulk insert 350 baris ≈ **5–15 ms**. Sekitar 50–100 kali lebih cepat, dan bedanya melebar seiring naiknya latensi jaringan ke database.

Bedanya paling terasa justru di saat paling genting. Ketika listrik pulih dan 50 device serentak mengirim batch berisi 180 record, itu ~63.000 baris. Satu per satu: sekitar dua menit, dengan seluruh connection pool terkunci. Secara bulk: beberapa detik.

Di sistem ini, satu request batch selalu menjadi **satu** `INSERT` multi-VALUES lewat `createMany`, apa pun jumlah record-nya. `COPY` bisa lebih cepat lagi untuk puluhan ribu baris sekaligus, tetapi tidak mendukung `ON CONFLICT DO NOTHING` — dan idempotensi lebih berharga daripada sisa kecepatan itu pada skala ini.

### 5. Index apa yang dibuat di `sensor_reading`, dan kenapa urutan kolomnya penting?

Index utamanya adalah primary key:

```sql
PRIMARY KEY (device_id, sensor_type_id, channel, device_time)
```

**Kenapa urutan itu.** B-tree menyimpan baris terurut menurut kolom pertama, lalu kolom kedua di dalam tiap nilai kolom pertama, dan seterusnya — seperti buku telepon yang diurutkan nama belakang lalu nama depan. Akibatnya: **kolom yang dipakai dengan `=` harus di depan, kolom yang dipakai dengan rentang harus paling belakang.**

Query chart utamanya berbentuk:

```sql
WHERE device_id = $1 AND sensor_type_id = $2 AND channel = $3
  AND device_time BETWEEN $4 AND $5
```

Dengan urutan di atas, PostgreSQL melompat langsung ke titik awal rentang dan membaca berurutan sampai batas akhir — satu penelusuran menurun ditambah pemindaian rentang yang panjangnya persis sebesar data yang diminta.

**Kalau `device_time` ditaruh di depan** — `(device_time, device_id, sensor_type_id)` — index tetap "terpakai", tetapi caranya jauh lebih mahal: semua baris dari **semua device** dalam rentang itu dibaca lebih dulu, baru disaring. Pada 50 device, itu 50 kali lebih banyak pekerjaan untuk hasil yang sama. Begitu kolom rentang dilewati, kolom sesudahnya tidak bisa lagi dipakai mempersempit pencarian — hanya untuk menyaring baris yang sudah terlanjur dibaca.

Index yang benar-benar ada di tabel ini:

| Index | Melayani |
|---|---|
| PK `(device_id, sensor_type_id, channel, device_time)` | Query chart, sekaligus kunci idempotensi |
| `(device_id, device_time DESC)` | "Semua sensor satu device dalam rentang" — `sensor_type_id` tidak difilter, jadi PK tidak efisien di sini |
| `(device_time DESC)` | Dibuat otomatis `create_hypertable`; chunk exclusion dan query lintas device |
| `(device_id, sensor_type_id, channel, device_time DESC) INCLUDE (value, raw_value, quality_flags)` | `/readings/latest` sebagai index-only scan |
| `(device_id, device_time DESC) WHERE quality_flags <> 0` | Halaman diagnosa; parsial agar tetap kecil |

Perkiraan biayanya jujur: keempat index tambahan itu memakan sekitar 30 GB per tahun, hampir sebesar datanya sendiri (~28 GB). Yang paling mahal adalah index `latest` (~11 GB/tahun) dan kolom kuncinya sama persis dengan PK — kalau ruang disk menjadi masalah lebih dulu daripada latensi, itulah yang pertama saya buang.

### 6. Bagaimana mendeteksi sensor yang "macet" — mengirim data terus tapi nilainya identik selama 6 jam?

Sensor macet berbahaya justru karena terlihat sehat: heartbeat normal, data masuk tepat waktu, nilainya di dalam rentang wajar. Satu-satunya yang salah adalah angkanya tidak pernah berubah.

**Cara mendeteksinya: periksa keragaman nilai dalam jendela waktu**, dan `reading_aggregate` sudah menyimpan bahan yang diperlukan:

```sql
SELECT device_id, sensor_type_id, channel
FROM reading_aggregate
WHERE bucket_width = 'HOUR_1'
  AND bucket_start >= now() - INTERVAL '6 hours'
GROUP BY device_id, sensor_type_id, channel
HAVING max(max_value) - min(min_value) < 0.001
   AND sum(count_good) > 30;
```

Karena `min_value` dan `max_value` sudah terhitung per jam, pemeriksaan enam jam hanya menyentuh 6 baris per sensor — bukan 360 baris data mentah.

Dua hal yang membuat deteksi ini tidak menghasilkan alarm palsu:

**Ambangnya tidak boleh nol mutlak**, melainkan lebih kecil daripada resolusi sensor. Sensor suhu berpresisi 0,1 °C yang benar-benar berfungsi tetap akan menunjukkan sedikit riak.

**Ambangnya harus per tipe sensor.** Ini yang paling mudah keliru: beberapa besaran memang wajar diam. `solar_rad` bernilai 0 sepanjang malam selama 11 jam berturut-turut adalah benar, bukan macet. `rain_counter` yang tidak bergerak selama seminggu di musim kemarau juga benar. Kelembapan dan tekanan yang benar-benar beku selama enam jam hampir pasti sensor rusak. Karena itu aturannya diberi pengecualian: hanya berlaku pada `solar_rad` di siang hari, dan tidak berlaku sama sekali pada sensor kumulatif.

Hasilnya ditandai sebagai `STUCK_SENSOR` — nilainya sudah disediakan di bitmask quality flag. Yang belum saya kerjakan adalah job periodik yang menjalankan query ini dan menuliskan flag-nya; yang ada sekarang baru tempatnya, bukan pelaksananya.

### 7. Menambah alert "curah hujan > 20 mm/jam": di lapisan mana logika ini ditaruh?

**Di worker agregasi, tepat setelah sebuah bucket jam selesai dihitung ulang** — bukan di jalur ingestion, bukan di database, bukan di frontend.

Alasannya berangkat dari bunyi aturannya sendiri: "20 mm **per jam**". Yang diperiksa adalah besaran per jam, dan satu-satunya tempat besaran itu ada adalah bucket `HOUR_1`. Memeriksanya di tempat lain berarti menghitung ulang hal yang sudah dihitung.

**Kenapa bukan di ingestion.** Satu payload hanya membawa hujan satu interval — biasanya 0,2 sampai 1 mm. Untuk tahu totalnya sudah melewati 20 mm, ingestion harus menjumlahkan 60 pembacaan terakhir pada **setiap payload yang masuk**. Itu menambah query berat ke jalur terpanas di sistem, demi pemeriksaan yang hasilnya baru berubah sekali sejam.

**Kenapa bukan trigger database.** Trigger berjalan di dalam transaksi insert, sehingga kegagalan pengiriman notifikasi bisa menggagalkan penyimpanan data. Menukar data yang hilang dengan notifikasi yang terkirim adalah pertukaran yang salah arah. Logika bisnis di dalam trigger juga sulit diuji dan tidak terlihat oleh siapa pun yang membaca kode aplikasi.

**Kenapa bukan di frontend.** Alert harus bekerja ketika tidak ada orang yang membuka dashboard — dan justru saat itulah ia paling dibutuhkan.

**Kenapa worker agregasi cocok:** ia sudah tahu persis bucket mana yang nilainya baru berubah; ia berjalan di luar jalur request sehingga keterlambatan notifikasi tidak memperlambat ingestion; dan karena bucket dihitung ulang dari nol, ambangnya dinilai terhadap angka final — data terlambat yang masuk belakangan ikut memicu alert dengan benar.

Satu hal yang harus ada agar tidak menjadi mimpi buruk: **peredam pengulangan**. Bucket yang sama dihitung ulang setiap kali ada data terlambat, jadi alert harus mencatat "bucket ini sudah pernah memicu" dan tidak mengirim ulang untuk bucket yang sama.

### 8. Risiko keamanan pada endpoint ingestion yang terbuka ke internet, dan mitigasinya

| Risiko | Mitigasi yang ada | Yang belum |
|---|---|---|
| **Data palsu** — siapa pun mengirim pembacaan karangan | Setiap request wajib membawa `X-Device-Key` yang diverifikasi terhadap hash. `device_id` di payload dicocokkan dengan pemilik kredensial, jadi kredensial yang bocor pun tidak bisa menulis atas nama stasiun lain | — |
| **Kredensial bocor** dari perangkat yang dibongkar | Kredensial per device, bukan satu kunci bersama, sehingga satu perangkat yang dibongkar tidak membuka semuanya. Rotasi lewat endpoint tersendiri dengan masa tenggang 7 hari | Deteksi anomali: satu `key_id` yang tiba-tiba mengirim dari banyak IP berbeda |
| **Serangan volume** — membanjiri ingestion | Rate limit 120/menit per device, batas batch 500 record, batas ukuran body | Rate limit lapisan jaringan (WAF/Cloudflare) untuk request yang bahkan belum lolos autentikasi |
| **Kehabisan sumber daya** lewat payload raksasa | Batas batch dan ukuran body; verifikasi kredensial memakai SHA-256 yang murah sehingga tidak bisa dipakai menghabiskan CPU | — |
| **Penyadapan & replay** | HTTPS mencegah penyadapan. Replay tidak berbahaya di sini: primary key membuat payload yang diputar ulang hanya menjadi duplikat yang diabaikan — idempotensi ternyata sekaligus mitigasi keamanan | Nonce/timestamp signing bila replay perlu ditolak, bukan sekadar diabaikan |
| **Injeksi** | Seluruh query memakai parameter (Prisma dan `Prisma.sql`), tidak ada penggabungan string. Validasi bentuk dan tipe sebelum menyentuh database | — |
| **Kebocoran informasi lewat pesan error** | Kredensial tidak ditemukan dan secret salah dijawab dengan pesan yang sama persis, agar endpoint ini tidak bisa dipakai memetakan `key_id` yang valid. Detail error internal tidak pernah keluar; yang keluar hanya kode dan `request_id` | — |
| **Pencemaran data** — device rusak mengirim nilai gila | Validasi rentang menandai tanpa membuang; nilai bertanda dikecualikan dari agregat statistik | Karantina otomatis: device yang terus-menerus mengirim data bertanda dipindahkan ke status MAINTENANCE |

**Dua yang paling menentukan** menurut saya: (1) kredensial **per device**, karena satu kunci bersama berarti satu perangkat yang dibongkar membuka seluruh armada dan rotasinya mustahil dilakukan tanpa mematikan semuanya; dan (2) **idempotensi**, karena ia mengubah serangan replay dari ancaman integritas data menjadi sekadar duplikat yang diabaikan diam-diam.

**Satu risiko yang belum tertangani dan perlu saya sebut terus terang:** tidak ada pembatasan siapa yang boleh memanggil endpoint manajemen. Sampai autentikasi user dashboard selesai, siapa pun yang bisa menjangkau API bisa mendaftarkan device dan merotasi kredensial. Untuk deployment sungguhan, itu harus ditutup lebih dulu sebelum apa pun yang lain.
