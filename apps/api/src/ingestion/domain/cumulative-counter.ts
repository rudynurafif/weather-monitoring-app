/**
 * Konversi pencacah kumulatif menjadi besaran per interval.
 *
 * Kasus nyatanya adalah `rain_counter`: sebuah tipping bucket yang mengirim
 * JUMLAH TOTAL jungkitan sejak device menyala, bukan curah hujan. Spesifikasi
 * payload menyebutkan tiga sifatnya:
 *
 *   1. nilainya hanya naik;
 *   2. 1 jungkitan = 0.2 mm;
 *   3. nilainya kembali ke 0 setiap device restart.
 *
 * Artinya angka 1043 pada payload sama sekali bukan "1043 mm hujan" — yang
 * bermakna hanyalah SELISIHNYA terhadap pembacaan sebelumnya.
 *
 * Fungsi di file ini sengaja murni: tanpa akses database, tanpa tanggal, tanpa
 * dependensi apa pun. Semua yang dibutuhkan masuk lewat argumen, sehingga
 * seluruh kasus sulitnya bisa diuji tanpa menjalankan satu pun container.
 */

export interface CumulativeDeltaInput {
  /**
   * Nilai pencacah pada pembacaan SEBELUMNYA dari sensor yang sama.
   * `null` berarti belum ada pembacaan sebelumnya yang diketahui.
   */
  previousRaw: number | null;

  /** Nilai pencacah pada pembacaan yang sedang diproses. */
  currentRaw: number;

  /** Faktor konversi satu cacahan ke satuan fisik. rain_counter: 0.2 mm. */
  unitPerCount: number;

  /**
   * Batas atas delta yang masih masuk akal untuk satu interval, dalam satuan
   * fisik. Opsional. Untuk hujan per menit, 20 mm/menit sudah jauh di atas
   * rekor dunia, jadi nilai di atas itu hampir pasti pencacah yang rusak.
   */
  maxPlausibleDelta?: number | null;
}

export interface CumulativeDeltaResult {
  /** Selisih dalam satuan fisik (mm untuk hujan). Tidak pernah negatif. */
  delta: number;

  /** Pencacah terdeteksi mundur, yang berarti device restart di antara dua pembacaan. */
  counterReset: boolean;

  /** Delta melampaui `maxPlausibleDelta`. Nilainya tetap dikembalikan, hanya ditandai. */
  implausible: boolean;

  /** Tidak ada pembacaan sebelumnya, sehingga delta belum bisa dihitung. */
  firstReading: boolean;
}

/**
 * Pembulatan ke 4 angka di belakang koma.
 *
 * Tanpa ini, 1045 dikurangi 1043 lalu dikali 0.2 menghasilkan
 * 0.4000000000000057 karena aritmetika floating point. Angka seperti itu
 * menjengkelkan saat dijumlahkan ribuan kali dan jelek saat ditampilkan.
 * Empat angka desimal jauh melampaui presisi 0.2 mm milik sensornya.
 */
function round4(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

/**
 * Menghitung selisih satu langkah dari pencacah kumulatif.
 *
 * Ada tiga cabang, dan masing-masing punya alasan:
 *
 * **1. Belum ada pembacaan sebelumnya** (`previousRaw === null`)
 *    Delta dikembalikan 0, bukan `currentRaw * unitPerCount`.
 *    Sebabnya: pencacah bernilai 1043 hanya memberi tahu bahwa sejak device
 *    menyala sudah ada 1043 jungkitan — dan kita tidak tahu itu terjadi dalam
 *    rentang waktu berapa. Melaporkannya sebagai hujan pada menit ini berarti
 *    mencatat 208.6 mm untuk satu menit. Memilih 0 berarti kita kehilangan satu
 *    interval di awal seri; memilih nilai penuh berarti merusak total harian.
 *    Kehilangan satu interval jauh lebih murah.
 *
 * **2. Pencacah naik atau tetap** (`currentRaw >= previousRaw`) — kasus normal.
 *    delta = (current - previous) * unitPerCount
 *
 * **3. Pencacah mundur** (`currentRaw < previousRaw`) — device restart.
 *    delta = currentRaw * unitPerCount, dan `counterReset` ditandai true.
 *    Sebabnya: setelah restart, pencacah mulai lagi dari 0, sehingga nilai
 *    sekarang ADALAH jumlah jungkitan sejak restart itu.
 *
 *    Yang hilang di cabang ini, dan memang tidak bisa diselamatkan: hujan yang
 *    turun antara pembacaan terakhir sebelum mati dan saat device menyala
 *    kembali. Jungkitan itu tercatat di pencacah yang sudah dinolkan, dan tidak
 *    ada informasi tersisa untuk memulihkannya. Sistem ini memilih melaporkan
 *    KURANG daripada mengarang angka.
 *
 *    Kalau device restart dua kali dalam satu jam, tiap restart diproses
 *    terpisah sebagai satu langkah tersendiri — karena fungsi ini bekerja per
 *    pasang pembacaan berurutan, bukan per rentang waktu. Jadi hasilnya tetap
 *    benar: setiap segmen antar-restart dihitung utuh, dan yang hilang hanya
 *    celah di titik restart itu sendiri. Inilah alasan batch WAJIB diurutkan
 *    menurut `ts` sebelum diproses; urutan yang acak akan membuat setiap
 *    langkah mundur salah dikira restart.
 */
export function computeCumulativeDelta(input: CumulativeDeltaInput): CumulativeDeltaResult {
  const { previousRaw, currentRaw, unitPerCount, maxPlausibleDelta } = input;

  // Kasus 1: belum ada acuan.
  if (previousRaw === null || previousRaw === undefined) {
    return { delta: 0, counterReset: false, implausible: false, firstReading: true };
  }

  // Kasus 3: pencacah mundur -> device restart.
  const counterReset = currentRaw < previousRaw;

  // Kasus 2 dan 3 memakai rumus yang sama dengan titik acuan berbeda:
  // setelah restart, acuannya adalah 0.
  const countDelta = counterReset ? currentRaw : currentRaw - previousRaw;

  // Penjaga terakhir. Pencacah yang sah tidak pernah negatif; kalau toh terjadi
  // (firmware cacat), lebih baik melaporkan 0 daripada hujan negatif yang akan
  // mengurangi total harian.
  const safeCountDelta = Math.max(0, countDelta);
  const delta = round4(safeCountDelta * unitPerCount);

  const implausible =
    maxPlausibleDelta !== null && maxPlausibleDelta !== undefined && delta > maxPlausibleDelta;

  return { delta, counterReset, implausible, firstReading: false };
}

/**
 * Versi berurutan untuk satu batch pembacaan dari sensor yang sama.
 *
 * Dipakai jalur ingestion saat device yang sempat offline mengirim 180 record
 * sekaligus. Wajib menerima input yang SUDAH terurut menurut waktu menaik —
 * pemanggilnya yang bertanggung jawab mengurutkan, dan fungsi ini tidak
 * mengurutkan sendiri supaya urutan hasilnya tetap sejajar dengan input.
 *
 * Hasil setiap langkah menjadi acuan langkah berikutnya, sehingga satu batch
 * yang memuat dua kali restart tetap terhitung benar.
 */
export function computeCumulativeDeltaSeries(
  readings: readonly number[],
  options: { previousRaw: number | null; unitPerCount: number; maxPlausibleDelta?: number | null },
): CumulativeDeltaResult[] {
  let previous = options.previousRaw;

  return readings.map((currentRaw) => {
    const result = computeCumulativeDelta({
      previousRaw: previous,
      currentRaw,
      unitPerCount: options.unitPerCount,
      maxPlausibleDelta: options.maxPlausibleDelta,
    });
    previous = currentRaw;
    return result;
  });
}
