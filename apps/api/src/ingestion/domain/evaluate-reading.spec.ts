import {
  evaluateReading,
  evaluateTimestampFlags,
  isSentinelError,
  type SensorTypeSpec,
} from './evaluate-reading';
import { describeFlags, isUsable, QualityFlag } from './quality-flags';

/**
 * Deliverable 4.5 nomor 2: validasi rentang & quality flag.
 *
 * Berkas ini sekaligus menjadi bukti tertulis untuk kasus-kasus di Bagian F.3,
 * sehingga klaim di dokumen bisa diperiksa, bukan sekadar dipercaya.
 */

const suhu: SensorTypeSpec = {
  id: 1,
  key: 'temp_air',
  minValid: -20,
  maxValid: 60,
  isCumulative: false,
  unitPerCount: null,
  isCircular: false,
};

const kelembapan: SensorTypeSpec = {
  id: 2,
  key: 'humidity',
  minValid: 0,
  maxValid: 100,
  isCumulative: false,
  unitPerCount: null,
  isCircular: false,
};

const hujan: SensorTypeSpec = {
  id: 6,
  key: 'rain_counter',
  minValid: 0,
  maxValid: 1_000_000,
  isCumulative: true,
  unitPerCount: 0.2,
  isCircular: false,
};

describe('evaluateReading — nilai normal', () => {
  it('menerima nilai di dalam rentang tanpa flag apa pun', () => {
    const hasil = evaluateReading({
      rawValue: 27.4,
      sensorType: suhu,
      calibration: { id: 'cal-1', offset: 0, scale: 1 },
    });

    expect(hasil.qualityFlags).toBe(QualityFlag.OK);
    expect(hasil.value).toBe(27.4);
    expect(isUsable(hasil.qualityFlags)).toBe(true);
  });

  it('menandai UNCALIBRATED ketika tidak ada kalibrasi yang berlaku', () => {
    const hasil = evaluateReading({ rawValue: 27.4, sensorType: suhu, calibration: null });

    expect(describeFlags(hasil.qualityFlags)).toContain('UNCALIBRATED');
    expect(hasil.value).toBe(27.4);
    // Tidak terkalibrasi BUKAN alasan membuang data dari statistik.
    expect(isUsable(hasil.qualityFlags)).toBe(true);
  });
});

describe('F.3 kasus 2 — temp_air bernilai -999 (kode error sensor)', () => {
  it('menandai SENSOR_ERROR dan menjadikan value null', () => {
    const hasil = evaluateReading({
      rawValue: -999,
      sensorType: suhu,
      calibration: { id: 'cal-1', offset: 0, scale: 1 },
    });

    expect(describeFlags(hasil.qualityFlags)).toEqual(['SENSOR_ERROR']);
    // Nilai mentah TETAP disimpan sebagai bukti apa yang dikirim device...
    expect(hasil.rawValue).toBe(-999);
    // ...tetapi value di-null-kan supaya tidak ikut terhitung. Kalau -999
    // tersimpan sebagai angka, ia akan menyeret rata-rata suhu ke bawah
    // secara diam-diam.
    expect(hasil.value).toBeNull();
    expect(isUsable(hasil.qualityFlags)).toBe(false);
  });

  it('tidak menandai OUT_OF_RANGE untuk sentinel', () => {
    // Sentinel diperiksa LEBIH DULU. Kalau pemeriksaan rentang jalan duluan,
    // -999 hanya akan tercatat "di luar rentang" dan alasan sebenarnya hilang.
    const hasil = evaluateReading({ rawValue: -999, sensorType: suhu, calibration: null });

    expect(describeFlags(hasil.qualityFlags)).not.toContain('OUT_OF_RANGE');
  });

  it('tidak menghasilkan delta ketika pencacah mengirim sentinel', () => {
    // Kalau -999 dipakai sebagai nilai pencacah, pembacaan berikutnya akan
    // dikira lonjakan raksasa dan mencatat hujan ratusan milimeter.
    const hasil = evaluateReading({
      rawValue: -999,
      sensorType: hujan,
      calibration: null,
      previousCumulativeRaw: 1043,
    });

    expect(hasil.deltaValue).toBeNull();
  });

  it('mengenali daftar sentinel', () => {
    expect(isSentinelError(-999)).toBe(true);
    expect(isSentinelError(-9999)).toBe(true);
    expect(isSentinelError(-99)).toBe(false);
    expect(isSentinelError(27.4)).toBe(false);
  });
});

describe('F.3 kasus 3 — humidity bernilai 150 (di luar rentang 0-100)', () => {
  it('menyimpan nilainya tetapi menandai OUT_OF_RANGE', () => {
    const hasil = evaluateReading({
      rawValue: 150,
      sensorType: kelembapan,
      calibration: { id: 'cal-1', offset: 0, scale: 1 },
    });

    expect(describeFlags(hasil.qualityFlags)).toContain('OUT_OF_RANGE');
    // Nilainya TIDAK di-null-kan dan TIDAK dibuang. Kelembapan 150% adalah
    // bukti sensor rusak — bukti yang hilang kalau barisnya tidak disimpan.
    expect(hasil.value).toBe(150);
    expect(hasil.rawValue).toBe(150);
    // Tetapi ia dikecualikan dari perhitungan statistik.
    expect(isUsable(hasil.qualityFlags)).toBe(false);
  });

  it('memeriksa rentang terhadap nilai SETELAH kalibrasi', () => {
    // Rentang wajar adalah rentang fisik, jadi yang dibandingkan harus nilai
    // yang sudah dikoreksi. Nilai mentah 98 dengan offset +5 menjadi 103 dan
    // memang melanggar batas 100.
    const hasil = evaluateReading({
      rawValue: 98,
      sensorType: kelembapan,
      calibration: { id: 'cal-1', offset: 5, scale: 1 },
    });

    expect(hasil.value).toBe(103);
    expect(describeFlags(hasil.qualityFlags)).toContain('OUT_OF_RANGE');
  });

  it('menerima nilai tepat di batas rentang', () => {
    for (const nilai of [0, 100]) {
      const hasil = evaluateReading({
        rawValue: nilai,
        sensorType: kelembapan,
        calibration: { id: 'cal-1', offset: 0, scale: 1 },
      });
      expect(describeFlags(hasil.qualityFlags)).not.toContain('OUT_OF_RANGE');
    }
  });
});

describe('F.3 kasus 4 — rain_counter turun (device restart)', () => {
  it('menandai COUNTER_RESET dan tetap menghasilkan delta non-negatif', () => {
    const hasil = evaluateReading({
      rawValue: 5,
      sensorType: hujan,
      calibration: null,
      previousCumulativeRaw: 1043,
    });

    expect(describeFlags(hasil.qualityFlags)).toContain('COUNTER_RESET');
    expect(hasil.deltaValue).toBe(1); // 5 jungkitan x 0.2 mm
    expect(hasil.deltaValue).toBeGreaterThanOrEqual(0);
  });

  it('COUNTER_RESET tidak membuat pembacaan dibuang dari statistik', () => {
    // Pembacaan saat counter reset tetap mewakili hujan yang benar-benar
    // turun, jadi ia tidak termasuk flag yang membuat data tak terpakai.
    const hasil = evaluateReading({
      rawValue: 5,
      sensorType: hujan,
      calibration: null,
      previousCumulativeRaw: 1043,
    });

    expect(isUsable(hasil.qualityFlags)).toBe(true);
  });
});

describe('bitmask quality flag', () => {
  it('menyimpan beberapa masalah sekaligus pada satu pembacaan', () => {
    // Inilah alasan memakai bitmask dan bukan satu kolom enum: nilai di luar
    // rentang YANG JUGA datang dari payload bertimestamp masa depan adalah dua
    // masalah berbeda, dan keduanya perlu terekam.
    const hasil = evaluateReading({
      rawValue: 150,
      sensorType: kelembapan,
      calibration: null,
      baseFlags: QualityFlag.FUTURE_TIMESTAMP,
    });

    const flags = describeFlags(hasil.qualityFlags);
    expect(flags).toContain('OUT_OF_RANGE');
    expect(flags).toContain('FUTURE_TIMESTAMP');
    expect(flags).toContain('UNCALIBRATED');
  });

  it('mewariskan flag tingkat payload ke setiap pembacaan di dalamnya', () => {
    const hasil = evaluateReading({
      rawValue: 27.4,
      sensorType: suhu,
      calibration: { id: 'c', offset: 0, scale: 1 },
      baseFlags: QualityFlag.DEVICE_MAINTENANCE | QualityFlag.LATE_ARRIVAL,
    });

    expect(describeFlags(hasil.qualityFlags).sort()).toEqual([
      'DEVICE_MAINTENANCE',
      'LATE_ARRIVAL',
    ]);
  });

  it('menganggap OK sebagai daftar flag kosong', () => {
    expect(describeFlags(QualityFlag.OK)).toEqual([]);
    expect(isUsable(QualityFlag.OK)).toBe(true);
  });
});

describe('F.3 kasus 1 — timestamp di masa depan', () => {
  const serverTime = new Date('2026-09-21T10:00:00Z');

  it('tidak menandai apa pun untuk selisih dalam batas toleransi', () => {
    const flags = evaluateTimestampFlags({
      deviceTime: new Date('2026-09-21T10:02:00Z'), // 2 menit di depan
      serverTime,
      clockDriftToleranceSeconds: 300,
    });

    expect(flags).toBe(QualityFlag.OK);
  });

  it('menandai FUTURE_TIMESTAMP ketika jam device maju 2 jam', () => {
    // Soal menyebut kasus ini persis: device clock salah, maju 2 jam.
    // Jawabannya: DITERIMA dengan flag, bukan ditolak. Nilainya tetap
    // disimpan apa adanya; menggeser device_time berarti mengubah data
    // berdasarkan tebakan, dan kalau tebakannya salah kedua versinya hilang.
    const flags = evaluateTimestampFlags({
      deviceTime: new Date('2026-09-21T12:00:00Z'),
      serverTime,
      clockDriftToleranceSeconds: 300,
    });

    expect(describeFlags(flags)).toContain('FUTURE_TIMESTAMP');
  });

  it('menandai LATE_ARRIVAL untuk data buffered yang sudah lama', () => {
    const flags = evaluateTimestampFlags({
      deviceTime: new Date('2026-09-21T06:00:00Z'), // 4 jam terlambat
      serverTime,
      clockDriftToleranceSeconds: 300,
      lateArrivalThresholdSeconds: 3600,
    });

    expect(describeFlags(flags)).toContain('LATE_ARRIVAL');
    expect(describeFlags(flags)).not.toContain('FUTURE_TIMESTAMP');
  });

  it('LATE_ARRIVAL tidak membuat data dikecualikan dari statistik', () => {
    // Data yang terlambat nilainya tetap sah — yang berubah hanya kapan ia
    // sampai, bukan apa yang terukur.
    const flags = evaluateTimestampFlags({
      deviceTime: new Date('2026-09-21T06:00:00Z'),
      serverTime,
      clockDriftToleranceSeconds: 300,
    });

    expect(isUsable(flags)).toBe(true);
  });
});
