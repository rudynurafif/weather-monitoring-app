import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Pembuatan dan verifikasi kredensial device.
 *
 * Kredensial berbentuk dua bagian yang dikirim dalam satu header:
 *
 *     X-Device-Key: <key_id>.<secret>
 *
 * `key_id` publik dan terindeks unik; `secret` rahasia dan hanya pernah ada
 * satu kali, yaitu di response saat dibuat atau dirotasi.
 *
 * Alasan setiap pilihan di bawah ini diuraikan di JAWABAN.md bagian A.2.
 * Ringkasnya:
 *
 *  - Dipecah dua bagian supaya verifikasi cukup satu lookup index, bukan
 *    memindai seluruh tabel lalu mencocokkan hash satu per satu.
 *  - Memakai SHA-256, BUKAN bcrypt/argon2. Ini kebalikan dari aturan password:
 *    secret di sini dibangkitkan acak 256 bit, sehingga tidak ada kamus yang
 *    bisa menebaknya dan KDF lambat tidak menambah keamanan sama sekali. Yang
 *    ditambahkannya justru masalah — hashing lambat dijalankan pada setiap
 *    payload masuk dan menjadikan endpoint ingestion sasaran kehabisan CPU.
 *  - Pepper disimpan di environment, bukan di database, sehingga dump database
 *    saja tidak cukup untuk memalsukan device.
 */

const KEY_ID_BYTES = 8; // 16 karakter heksadesimal
const SECRET_BYTES = 32; // 256 bit
const SECRET_DISPLAY_PREFIX = 'wsk_';

export interface GeneratedCredential {
  keyId: string;
  /** Nilai lengkap yang harus disimpan device. Hanya dikembalikan sekali. */
  token: string;
  secretHash: string;
  secretPrefix: string;
}

/** Membuat pasangan kredensial baru. */
export function generateCredential(pepper: string): GeneratedCredential {
  const keyId = randomBytes(KEY_ID_BYTES).toString('hex');
  const secret = SECRET_DISPLAY_PREFIX + randomBytes(SECRET_BYTES).toString('base64url');

  return {
    keyId,
    token: `${keyId}.${secret}`,
    secretHash: hashSecret(secret, pepper),
    // Cukup untuk membedakan beberapa kredensial di UI, terlalu pendek untuk
    // mempersempit tebakan terhadap 256 bit sisanya.
    secretPrefix: secret.slice(0, 12),
  };
}

/** SHA-256 dari secret yang digabung pepper, dalam heksadesimal. */
export function hashSecret(secret: string, pepper: string): string {
  return createHash('sha256').update(`${secret}${pepper}`, 'utf8').digest('hex');
}

/**
 * Memisahkan header menjadi key_id dan secret.
 *
 * Memakai `indexOf` alih-alih `split('.')` karena secret di-encode base64url
 * yang bisa saja memuat karakter titik pada format lain — yang menjadi
 * pemisah hanyalah titik PERTAMA.
 */
export function parseDeviceKey(header: string): { keyId: string; secret: string } | null {
  const separator = header.indexOf('.');
  if (separator <= 0 || separator === header.length - 1) {
    return null;
  }

  return {
    keyId: header.slice(0, separator),
    secret: header.slice(separator + 1),
  };
}

/**
 * Membandingkan dua hash heksadesimal dalam waktu tetap.
 *
 * Perbandingan `===` biasa berhenti pada karakter pertama yang berbeda,
 * sehingga lamanya proses membocorkan berapa banyak karakter awal yang sudah
 * benar. Dengan cukup banyak percobaan, kebocoran sekecil itu bisa dipakai
 * menebak hash karakter demi karakter.
 */
export function verifySecret(secret: string, expectedHash: string, pepper: string): boolean {
  const actual = Buffer.from(hashSecret(secret, pepper), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');

  // timingSafeEqual melempar error bila panjangnya berbeda, dan perbedaan
  // panjang itu sendiri sudah membocorkan informasi — jadi diperiksa lebih dulu.
  if (actual.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(actual, expected);
}
