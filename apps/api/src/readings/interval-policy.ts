import { ReadingInterval } from './dto/query-readings.dto';

/**
 * Kebijakan resolusi: mencegah response membengkak ketika klien meminta
 * rentang yang sangat lebar.
 *
 * Ini jawaban atas pertanyaan wajib Bagian E — "bagaimana mencegah response
 * GET /readings membengkak ketika user meminta rentang 1 tahun?"
 *
 * Tiga lapis pertahanan, dan semuanya ada di SERVER:
 *
 *   1. Resolusi minimum menurut lebar rentang. Rentang satu tahun tidak akan
 *      pernah dilayani dari data mentah, berapa pun yang diminta klien.
 *   2. Batas jumlah titik yang dikembalikan.
 *   3. Batas lebar rentang itu sendiri.
 *
 * Keputusan ini sengaja TIDAK diserahkan ke klien. Kalau frontend yang memilih,
 * cukup satu permintaan salah ketik untuk menarik 184 juta baris.
 *
 * Fungsi-fungsi di sini murni supaya kebijakannya bisa diuji tanpa database.
 */

/** Batas atas jumlah titik dalam satu response. */
export const MAX_POINTS = 5_000;

/** Rentang terlebar yang boleh diminta sekali jalan. */
export const MAX_RANGE_DAYS = 400;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Urutan dari paling halus ke paling kasar. */
const COARSENESS: ReadingInterval[] = [
  ReadingInterval.RAW,
  ReadingInterval.MINUTE_1,
  ReadingInterval.HOUR_1,
  ReadingInterval.DAY_1,
];

/**
 * Resolusi paling halus yang masih diizinkan untuk sebuah lebar rentang.
 *
 * Angkanya diturunkan dari MAX_POINTS dengan asumsi satu pembacaan per menit:
 *   - 24 jam pada resolusi mentah  = 1.440 titik  -> masih wajar
 *   - 7 hari pada resolusi mentah  = 10.080 titik -> terlalu banyak, naik ke 1h
 *   - 7 hari pada resolusi 1 jam   = 168 titik    -> nyaman
 *   - 1 tahun pada resolusi 1 jam  = 8.760 titik  -> terlalu banyak, naik ke 1d
 *   - 1 tahun pada resolusi 1 hari = 365 titik    -> nyaman
 */
export function minimumInterval(rangeMs: number): ReadingInterval {
  if (rangeMs <= 26 * HOUR_MS) {
    return ReadingInterval.RAW;
  }
  if (rangeMs <= 3 * DAY_MS) {
    return ReadingInterval.MINUTE_1;
  }
  if (rangeMs <= 100 * DAY_MS) {
    return ReadingInterval.HOUR_1;
  }
  return ReadingInterval.DAY_1;
}

export interface ResolvedInterval {
  applied: ReadingInterval;
  requested: ReadingInterval;
  /** True bila server menaikkan resolusi secara paksa. */
  coarsened: boolean;
}

/**
 * Menentukan resolusi yang benar-benar dipakai.
 *
 * Kalau klien meminta resolusi yang lebih halus daripada yang diizinkan,
 * server MENAIKKANNYA, bukan menolak request. Alasannya: chart yang mengubah
 * rentang dari 24 jam ke 1 tahun seharusnya tetap menggambar sesuatu, bukan
 * menampilkan pesan error yang memaksa pengguna menebak parameter yang benar.
 * Penyesuaiannya dilaporkan terbuka di `meta.interval_applied` supaya klien
 * tahu data yang diterimanya bukan resolusi yang ia minta.
 */
export function resolveInterval(requested: ReadingInterval, rangeMs: number): ResolvedInterval {
  const minimum = minimumInterval(rangeMs);
  const applied =
    COARSENESS.indexOf(requested) < COARSENESS.indexOf(minimum) ? minimum : requested;

  return { applied, requested, coarsened: applied !== requested };
}

/** Perkiraan jumlah titik untuk sebuah rentang dan resolusi. */
export function estimatePointCount(rangeMs: number, interval: ReadingInterval): number {
  switch (interval) {
    case ReadingInterval.RAW:
    case ReadingInterval.MINUTE_1:
      return Math.ceil(rangeMs / 60_000);
    case ReadingInterval.HOUR_1:
      return Math.ceil(rangeMs / HOUR_MS);
    case ReadingInterval.DAY_1:
      return Math.ceil(rangeMs / DAY_MS);
  }
}
