/**
 * Deklarasi ambient untuk impor stylesheet.
 *
 * `import './globals.css'` adalah impor efek samping: yang memprosesnya bundler
 * Next, bukan TypeScript. Tanpa deklarasi ini TypeScript gagal me-resolve
 * modulnya — `tsc` kebetulan diam karena impor tanpa binding memang tidak
 * pernah dilaporkan, tetapi language server di editor menandainya sebagai
 * "Cannot find module". Satu baris ini membuat keduanya sepakat.
 *
 * Next.js tidak menyertakan deklarasi ini sendiri; `next-env.d.ts` hanya
 * mencakup tipe gambar dan route.
 */
declare module '*.css';
