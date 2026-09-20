import {
  computeCumulativeDelta,
  computeCumulativeDeltaSeries,
} from './cumulative-counter';

/**
 * Deliverable 4.5 nomor 1: konversi rain_counter menjadi curah hujan mm,
 * TERMASUK kasus counter reset.
 *
 * Spesifikasi yang diuji di sini datang langsung dari soal:
 *   - 1 jungkitan = 0.2 mm
 *   - pencacah hanya naik
 *   - pencacah kembali ke 0 setiap device restart
 */

const TIP_MM = 0.2;

describe('computeCumulativeDelta', () => {
  describe('kasus normal', () => {
    it('mengubah selisih jungkitan menjadi milimeter', () => {
      const result = computeCumulativeDelta({
        previousRaw: 1043,
        currentRaw: 1045,
        unitPerCount: TIP_MM,
      });

      // 2 jungkitan x 0.2 mm
      expect(result.delta).toBe(0.4);
      expect(result.counterReset).toBe(false);
      expect(result.firstReading).toBe(false);
    });

    it('menghasilkan 0 ketika pencacah tidak bergerak (tidak hujan)', () => {
      const result = computeCumulativeDelta({
        previousRaw: 1043,
        currentRaw: 1043,
        unitPerCount: TIP_MM,
      });

      expect(result.delta).toBe(0);
      expect(result.counterReset).toBe(false);
    });

    it('membulatkan hasil aritmetika floating point', () => {
      // Tanpa pembulatan, (1045 - 1043) * 0.2 di JavaScript menghasilkan
      // 0.4000000000000057 — angka yang jelek saat ditampilkan dan menumpuk
      // kesalahan ketika dijumlahkan ribuan kali.
      const result = computeCumulativeDelta({
        previousRaw: 1043,
        currentRaw: 1048,
        unitPerCount: TIP_MM,
      });

      expect(result.delta).toBe(1);
      expect(Number.isInteger(result.delta * 10)).toBe(true);
    });
  });

  describe('pembacaan pertama', () => {
    it('mengembalikan 0, BUKAN nilai penuh pencacah', () => {
      // Inilah keputusan yang paling mudah salah. Pencacah bernilai 1043 tidak
      // berarti 208.6 mm hujan pada menit ini — kita sama sekali tidak tahu
      // rentang waktu 1043 jungkitan itu terkumpul. Melaporkan 0 kehilangan
      // satu interval; melaporkan nilai penuh merusak total harian.
      const result = computeCumulativeDelta({
        previousRaw: null,
        currentRaw: 1043,
        unitPerCount: TIP_MM,
      });

      expect(result.delta).toBe(0);
      expect(result.firstReading).toBe(true);
      expect(result.counterReset).toBe(false);
    });
  });

  describe('counter reset (device restart)', () => {
    it('menandai reset dan memakai nilai sekarang sebagai selisih', () => {
      // Soal F.3 nomor 4: rain_counter turun dari 1043 menjadi 5.
      // Setelah restart pencacah mulai dari 0, jadi angka 5 ADALAH jumlah
      // jungkitan sejak device menyala kembali.
      const result = computeCumulativeDelta({
        previousRaw: 1043,
        currentRaw: 5,
        unitPerCount: TIP_MM,
      });

      expect(result.counterReset).toBe(true);
      expect(result.delta).toBe(1); // 5 x 0.2
    });

    it('TIDAK PERNAH menghasilkan curah hujan negatif', () => {
      // Ini jaminan terpenting dari seluruh fungsi ini. Curah hujan negatif
      // akan mengurangi total harian dan merusak agregat secara diam-diam.
      const drops = [
        { previousRaw: 1043, currentRaw: 5 },
        { previousRaw: 9999, currentRaw: 0 },
        { previousRaw: 500, currentRaw: 499 },
      ];

      for (const drop of drops) {
        const result = computeCumulativeDelta({ ...drop, unitPerCount: TIP_MM });
        expect(result.delta).toBeGreaterThanOrEqual(0);
      }
    });

    it('menganggap pencacah negatif sebagai 0, bukan hujan negatif', () => {
      const result = computeCumulativeDelta({
        previousRaw: 100,
        currentRaw: -20,
        unitPerCount: TIP_MM,
      });

      expect(result.delta).toBe(0);
    });
  });

  describe('delta yang tidak masuk akal', () => {
    it('menandai lonjakan yang melampaui batas wajar tanpa membuang nilainya', () => {
      const result = computeCumulativeDelta({
        previousRaw: 1000,
        currentRaw: 2000, // 1000 jungkitan = 200 mm dalam satu interval
        unitPerCount: TIP_MM,
        maxPlausibleDelta: 20,
      });

      expect(result.implausible).toBe(true);
      // Nilainya TETAP dikembalikan. Menandai, bukan membuang — sama seperti
      // perlakuan terhadap nilai di luar rentang.
      expect(result.delta).toBe(200);
    });

    it('tidak menandai apa pun ketika batas tidak diberikan', () => {
      const result = computeCumulativeDelta({
        previousRaw: 1000,
        currentRaw: 2000,
        unitPerCount: TIP_MM,
      });

      expect(result.implausible).toBe(false);
    });
  });
});

describe('computeCumulativeDeltaSeries', () => {
  it('menghitung satu batch berurutan dengan benar', () => {
    // Data buffered: 4 pembacaan berturut-turut.
    const results = computeCumulativeDeltaSeries([1043, 1045, 1048, 1048], {
      previousRaw: 1042,
      unitPerCount: TIP_MM,
    });

    expect(results.map((r) => r.delta)).toEqual([0.2, 0.4, 0.6, 0]);
    expect(results.every((r) => !r.counterReset)).toBe(true);

    const total = results.reduce((sum, r) => sum + r.delta, 0);
    // Total = (1048 - 1042) x 0.2 = 1.2 mm
    expect(round(total)).toBe(1.2);
  });

  it('menangani DUA restart dalam satu batch', () => {
    // Inilah pertanyaan yang disebut panduan wawancara internal:
    // "kalau device restart 2x dalam satu jam, hasilnya masih benar?"
    //
    // Urutan pencacah: 100 -> 102 -> [restart] 3 -> 5 -> [restart] 2 -> 4
    const results = computeCumulativeDeltaSeries([100, 102, 3, 5, 2, 4], {
      previousRaw: 98,
      unitPerCount: TIP_MM,
    });

    expect(results.map((r) => r.delta)).toEqual([0.4, 0.4, 0.6, 0.4, 0.4, 0.4]);
    expect(results.map((r) => r.counterReset)).toEqual([
      false,
      false,
      true,
      false,
      true,
      false,
    ]);

    // Setiap segmen antar-restart terhitung utuh. Yang TIDAK terhitung adalah
    // hujan yang jatuh di celah restart itu sendiri — jungkitannya tercatat di
    // pencacah yang sudah dinolkan dan tidak ada informasi tersisa untuk
    // memulihkannya. Sistem ini memilih melaporkan kurang daripada mengarang.
    const total = results.reduce((sum, r) => sum + r.delta, 0);
    expect(round(total)).toBe(2.6);
  });

  it('memulai dari nol ketika tidak ada acuan sebelumnya', () => {
    const results = computeCumulativeDeltaSeries([500, 502, 505], {
      previousRaw: null,
      unitPerCount: TIP_MM,
    });

    expect(results[0].delta).toBe(0);
    expect(results[0].firstReading).toBe(true);
    expect(results[1].delta).toBe(0.4);
    expect(results[2].delta).toBe(0.6);
  });

  it('menghasilkan urutan hasil yang sejajar dengan urutan input', () => {
    // Fungsi ini sengaja TIDAK mengurutkan sendiri: pemanggil yang
    // bertanggung jawab, supaya hasilnya bisa dipetakan kembali ke record
    // aslinya. Uji ini mengunci kontrak tersebut.
    const input = [10, 12, 14];
    const results = computeCumulativeDeltaSeries(input, {
      previousRaw: 10,
      unitPerCount: 1,
    });

    expect(results).toHaveLength(input.length);
    expect(results.map((r) => r.delta)).toEqual([0, 2, 2]);
  });
});

function round(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}
