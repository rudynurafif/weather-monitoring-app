import {
  applyCalibration,
  findEffectiveCalibration,
  type EffectiveCalibration,
} from './calibration';

/**
 * Deliverable 4.5 nomor 4: penerapan kalibrasi (offset & scale).
 *
 * Dua hal yang diuji: rumusnya benar, dan pemilihan kalibrasi yang berlaku
 * memakai waktu PENGUKURAN, bukan waktu sekarang.
 */

describe('applyCalibration', () => {
  it('menerapkan rumus nilai = mentah * scale + offset', () => {
    const result = applyCalibration(27.4, { id: 'cal-1', offset: 0.5, scale: 1 });

    expect(result.value).toBeCloseTo(27.9, 5);
    expect(result.calibrationId).toBe('cal-1');
    expect(result.uncalibrated).toBe(false);
  });

  it('mengalikan lebih dulu, baru menambahkan', () => {
    // Urutannya bukan selera. `scale` mengoreksi kesalahan yang sebanding
    // dengan besaran yang diukur, `offset` mengoreksi pergeseran titik nol.
    // Kalau offset ditambahkan lebih dulu lalu dikalikan, offset-nya ikut
    // diperbesar oleh scale dan hasilnya salah secara fisika.
    const result = applyCalibration(10, { id: 'cal-1', offset: 2, scale: 3 });

    expect(result.value).toBe(32); // 10 * 3 + 2, bukan (10 + 2) * 3 = 36
  });

  it('menangani scale yang mengecilkan dan offset negatif', () => {
    const result = applyCalibration(100, { id: 'cal-1', offset: -5, scale: 0.98 });

    expect(result.value).toBeCloseTo(93, 5);
  });

  it('mengembalikan nilai mentah apa adanya ketika tidak ada kalibrasi', () => {
    const result = applyCalibration(27.4, null);

    // Pembacaan TIDAK dibuang hanya karena sensornya belum dikalibrasi: data
    // tanpa koreksi masih jauh lebih berguna daripada tidak ada data, asalkan
    // statusnya jujur tercatat.
    expect(result.value).toBe(27.4);
    expect(result.calibrationId).toBeNull();
    expect(result.uncalibrated).toBe(true);
  });

  it('tidak mengubah nilai ketika kalibrasinya netral', () => {
    const result = applyCalibration(27.4, { id: 'cal-1', offset: 0, scale: 1 });

    expect(result.value).toBe(27.4);
    expect(result.uncalibrated).toBe(false);
  });
});

describe('findEffectiveCalibration', () => {
  const pabrik: EffectiveCalibration = {
    id: 'cal-pabrik',
    offset: -0.4,
    scale: 1,
    effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    effectiveTo: new Date('2026-06-01T00:00:00Z'),
  };

  const lapangan: EffectiveCalibration = {
    id: 'cal-lapangan',
    offset: 0.3,
    scale: 1,
    effectiveFrom: new Date('2026-06-01T00:00:00Z'),
    effectiveTo: null,
  };

  const riwayat = [lapangan, pabrik]; // terbaru dulu, seperti dari database

  it('memilih kalibrasi yang berlaku pada waktu pengukuran', () => {
    const hasil = findEffectiveCalibration(riwayat, new Date('2026-03-15T10:00:00Z'));

    expect(hasil?.id).toBe('cal-pabrik');
  });

  it('data LAMA tetap memakai kalibrasi LAMA setelah kalibrasi diganti', () => {
    // Inilah jawaban atas pertanyaan desain Bagian B: nilai kalibrasi diubah
    // hari ini, apakah data lama ikut berubah? Tidak. Pengukuran 31 Mei tetap
    // dikoreksi dengan kalibrasi yang memang berlaku pada 31 Mei.
    const sebelum = findEffectiveCalibration(riwayat, new Date('2026-05-31T23:59:59Z'));
    const sesudah = findEffectiveCalibration(riwayat, new Date('2026-06-01T00:00:01Z'));

    expect(sebelum?.id).toBe('cal-pabrik');
    expect(sesudah?.id).toBe('cal-lapangan');
  });

  it('memakai rentang setengah terbuka: from <= t < to', () => {
    // Batas seperti ini membuat kalibrasi berurutan tidak pernah berebut satu
    // titik waktu — yang lama berakhir tepat di detik yang baru dimulai.
    const tepatDiBatas = findEffectiveCalibration(riwayat, new Date('2026-06-01T00:00:00Z'));

    expect(tepatDiBatas?.id).toBe('cal-lapangan');
  });

  it('memperlakukan effective_to null sebagai berlaku selamanya', () => {
    const jauhDiMasaDepan = findEffectiveCalibration(riwayat, new Date('2030-01-01T00:00:00Z'));

    expect(jauhDiMasaDepan?.id).toBe('cal-lapangan');
  });

  it('mengembalikan null untuk waktu sebelum kalibrasi pertama dibuat', () => {
    const hasil = findEffectiveCalibration(riwayat, new Date('2025-12-31T00:00:00Z'));

    expect(hasil).toBeNull();
  });

  it('mengembalikan null ketika sensor belum pernah dikalibrasi', () => {
    expect(findEffectiveCalibration([], new Date())).toBeNull();
  });

  it('data terlambat mendapat kalibrasi menurut waktu pengukurannya', () => {
    // Device offline pada Mei dan baru mengirim datanya pada Juli. Yang
    // menentukan koreksi adalah device_time (Mei), bukan saat data tiba.
    const deviceTime = new Date('2026-05-20T08:00:00Z');
    const hasil = findEffectiveCalibration(riwayat, deviceTime);

    expect(hasil?.id).toBe('cal-pabrik');

    const terkoreksi = applyCalibration(27.4, hasil!);
    expect(terkoreksi.value).toBeCloseTo(27.0, 5);
  });
});
