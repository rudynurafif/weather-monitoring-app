'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Tautan navigasi header yang tahu apakah ia sedang menunjuk halaman aktif.
 *
 * Dipisah menjadi komponen klien sendiri karena `usePathname` hanya tersedia
 * di sisi klien, sementara layout induknya tetap Server Component — cukup
 * tautan kecil ini yang ikut dikirim sebagai JavaScript, bukan seluruh header.
 *
 * `exact` dipakai untuk "/": tanpanya, setiap rute akan dianggap berada di
 * bawah "/" dan Overview selalu tampak aktif. Rute lain dicocokkan sebagai
 * awalan, supaya sub-halaman yang kelak ditambahkan di bawah /manage tetap
 * menandai Manajemen.
 */
export function NavLink({
  href,
  exact = false,
  children,
}: {
  href: string;
  exact?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isActive = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      // aria-current membuat pembaca layar ikut mengumumkan halaman aktif,
      // bukan hanya pengguna yang bisa melihat garis bawahnya.
      aria-current={isActive ? 'page' : undefined}
      className={
        isActive
          ? 'font-medium text-slate-900 underline decoration-2 underline-offset-4'
          : 'text-slate-600 hover:text-slate-900'
      }
    >
      {children}
    </Link>
  );
}
