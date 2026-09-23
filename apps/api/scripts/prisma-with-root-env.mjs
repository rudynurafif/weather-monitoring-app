/**
 * Menjalankan Prisma CLI dengan `.env` root monorepo ikut dimuat.
 *
 * Prisma CLI hanya mencari `.env` di folder skema dan folder kerja, dan tidak
 * menelusuri ke atas. Skrip di workspace ini berjalan dengan cwd `apps/api`,
 * sementara `.env`-nya ada di root monorepo — satu berkas untuk seluruh
 * workspace, supaya kredensial database tidak perlu ditulis dua kali. Tanpa
 * pembungkus ini, `prisma migrate deploy` dari mesin host berhenti dengan
 * `P1012 Environment variable not found: DATABASE_URL`.
 *
 * Di dalam container, seluruh konfigurasi datang dari docker-compose dan tidak
 * ada `.env` yang perlu dibaca, jadi ketiadaan berkasnya bukan error.
 *
 * Nilai yang sudah ada di environment TIDAK ditimpa, supaya variabel dari
 * docker-compose atau dari baris perintah selalu menang atas isi berkas —
 * aturan yang sama dengan yang dipakai `prisma/seed.ts`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function loadEnvFile() {
  for (const candidate of [join(here, '..', '..', '..', '.env'), join(process.cwd(), '.env')]) {
    if (!existsSync(candidate)) {
      continue;
    }

    for (const line of readFileSync(candidate, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith('#')) {
        continue;
      }

      const separator = trimmed.indexOf('=');
      if (separator === -1) {
        continue;
      }

      const key = trimmed.slice(0, separator).trim();
      // Tanda kutip di sekeliling nilai dilepas; isinya sendiri tidak diubah.
      const value = trimmed
        .slice(separator + 1)
        .trim()
        .replace(/^["']|["']$/g, '');

      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }

    return candidate;
  }

  return null;
}

loadEnvFile();

const require = createRequire(import.meta.url);
const result = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), ...process.argv.slice(2)], {
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
