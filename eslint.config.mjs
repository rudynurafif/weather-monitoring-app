import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';
import tseslint from 'typescript-eslint';

/**
 * Satu konfigurasi ESLint untuk seluruh monorepo.
 *
 * Dibuat satu di root, bukan satu per workspace, supaya aturannya tidak bisa
 * diam-diam berbeda antara backend dan frontend — dan supaya editor tidak
 * kebingungan mencari konfigurasi ketika membuka berkas di salah satunya.
 *
 * Memakai flat config (`eslint.config.mjs`), format bawaan ESLint 9.
 * `FlatCompat` hanya diperlukan untuk menjembatani `eslint-config-next` yang
 * masih memakai format lama.
 */
const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      'apps/api/prisma/migrations/**',
      '**/next-env.d.ts',
    ],
  },

  // Aturan dasar TypeScript untuk seluruh repo.
  ...tseslint.configs.recommended,

  // Aturan khusus React/Next, hanya untuk folder frontend.
  ...compat.extends('next/core-web-vitals').map((config) => ({
    ...config,
    files: ['apps/web/**/*.{ts,tsx}'],
  })),

  {
    rules: {
      /**
       * Aturan bawaan eslint-config-next ini mencari folder `pages/` dan
       * memperingatkan kalau tidak menemukannya. Proyek ini memakai App
       * Router sepenuhnya, jadi peringatannya memang tidak berlaku.
       */
      '@next/next/no-html-link-for-pages': 'off',

      /**
       * Tipe `any` dilarang, tetapi sebagai peringatan bukan error.
       *
       * Ada beberapa titik di mana data datang dari luar sistem tipe kita —
       * hasil `$queryRaw`, callback pustaka chart — dan memaksakan tipe ketat
       * di sana hanya menghasilkan kebohongan yang rapi. Yang penting ia
       * terlihat, bukan tersembunyi.
       */
      '@typescript-eslint/no-explicit-any': 'warn',

      /** Variabel tak terpakai boleh diawali garis bawah untuk menandai kesengajaan. */
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },

  {
    // Seeder dan simulator berjalan sebagai skrip mandiri; console.log di sana
    // memang sarana keluarannya, bukan sisa debugging.
    files: ['apps/api/prisma/**/*.ts', 'tools/**/*.js'],
    rules: {
      '@typescript-eslint/no-var-requires': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
];
