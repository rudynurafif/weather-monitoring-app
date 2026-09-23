'use client';

import { useEffect, useRef } from 'react';

/**
 * Modal yang dipakai bersama seluruh form manajemen.
 *
 * Dibangun di atas elemen `<dialog>` bawaan browser, bukan tumpukan `<div>`
 * dengan posisi tetap. Alasannya bukan soal sedikit-banyaknya kode, tetapi
 * perilaku yang sudah benar tanpa perlu ditulis ulang:
 *
 *  - fokus keyboard terkurung di dalam dialog selama terbuka, dan kembali ke
 *    elemen pemanggil saat ditutup;
 *  - Escape menutup dialog, lewat event `close` yang sama dengan penutupan
 *    lainnya sehingga hanya ada satu jalur penutupan yang perlu diurus;
 *  - isi di belakangnya menjadi inert — tidak bisa diklik maupun di-Tab —
 *    sehingga tabel device di belakang tidak ikut menerima interaksi;
 *  - halaman di belakang tidak ikut menggulir.
 *
 * Menulis semua itu sendiri berarti menulis ulang focus trap yang benar, dan
 * itu bagian yang paling mudah salah.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  size?: 'md' | 'lg';
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) {
      return;
    }

    // Dijaga agar tidak memanggil showModal() pada dialog yang sudah terbuka:
    // browser melemparkan InvalidStateError untuk itu.
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  /**
   * Klik di luar kotak isi ikut menutup.
   *
   * Pada `<dialog>`, klik pada backdrop tetap tercatat dengan target elemen
   * dialog itu sendiri. Karena itu dialognya dibuat tanpa padding dan seluruh
   * isinya dibungkus satu elemen anak — dengan begitu klik yang targetnya
   * benar-benar dialog hanya mungkin berasal dari area backdrop.
   */
  function handleClick(event: React.MouseEvent<HTMLDialogElement>) {
    if (event.target === ref.current) {
      onClose();
    }
  }

  return (
    <dialog
      ref={ref}
      // Satu jalur penutupan untuk Escape, tombol tutup, dan klik backdrop.
      onClose={onClose}
      onClick={handleClick}
      className={`m-auto w-[calc(100%-1.5rem)] rounded-lg border border-slate-200 bg-white p-0 shadow-xl backdrop:bg-slate-900/40 ${
        size === 'lg' ? 'max-w-4xl' : 'max-w-2xl'
      }`}
    >
      {/* Tinggi dibatasi tinggi layar supaya form panjang tetap bisa digulir
          di layar ponsel, bukan terpotong di bawah. */}
      <div className="flex max-h-[85vh] flex-col">
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
            {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="-mr-1 rounded-md px-2 py-1 text-lg leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            ×
          </button>
        </header>

        <div className="overflow-y-auto px-4 py-4">{children}</div>
      </div>
    </dialog>
  );
}
