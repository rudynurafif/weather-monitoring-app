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
