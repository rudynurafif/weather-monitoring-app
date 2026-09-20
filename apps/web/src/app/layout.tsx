import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Monitoring Stasiun Cuaca',
  description: 'Dashboard monitoring stasiun cuaca (IoT)',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id">
      <body className="min-h-screen bg-slate-50 antialiased">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <Link href="/" className="text-sm font-semibold text-slate-900">
              Monitoring Stasiun Cuaca
            </Link>
            <nav className="flex gap-4 text-sm">
              <Link href="/" className="text-slate-600 hover:text-slate-900">
                Ikhtisar
              </Link>
              <Link href="/manage" className="text-slate-600 hover:text-slate-900">
                Manajemen
              </Link>
            </nav>
            {/* Ditulis terbuka di kepala halaman supaya tidak ada keraguan
                soal zona waktu yang sedang ditampilkan. */}
            <span className="ml-auto text-xs text-slate-400">Semua waktu dalam WIB</span>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
