import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * DTO untuk payload yang dikirim device.
 *
 * Bentuknya MENGIKUTI spesifikasi firmware yang sudah terlanjur dibuat
 * (Bagian F.1) — nama field sengaja dibiarkan snake_case dan sependek aslinya
 * (`s`, `v`, `ts`, `fw`), bukan diubah menjadi camelCase yang lebih nyaman.
 * Backend yang menyesuaikan diri, bukan sebaliknya.
 *
 * Penerjemahan ke nama internal yang lebih jelas terjadi satu lapis di
 * belakang, di dalam service — sehingga hanya berkas ini yang terikat pada
 * bentuk payload device, dan mengganti firmware kelak cukup menyentuh satu
 * tempat.
 */

export class SensorReadingItemDto {
  @ApiProperty({
    example: 'temp_air',
    description:
      'Kunci tipe sensor. Boleh diberi akhiran channel dengan titik dua, mis. "temp_air:1" ' +
      'untuk sensor suhu kedua pada device yang sama. Tanpa akhiran berarti channel 0.',
  })
  @IsString()
  @MaxLength(40)
  s!: string;

  @ApiProperty({
    example: 27.4,
    description:
      'Nilai mentah, belum dikalibrasi. Nilai sentinel -999 berarti sensor sedang error ' +
      'dan akan disimpan dengan quality flag SENSOR_ERROR, bukan sebagai angka pengukuran.',
  })
  @IsNumber({ allowInfinity: false, allowNaN: false })
  v!: number;
}

/** Bagian payload yang berulang pada satu titik waktu. */
export class TelemetrySampleDto {
  @ApiProperty({
    example: 1757308800,
    description:
      'Unix epoch DETIK dalam UTC, menurut jam internal device. Inilah sumbu waktu ' +
      'time-series dan bagian dari kunci idempotensi.',
  })
  @IsInt()
  // Batas bawah 1 Januari 2020. Nilai di bawahnya hampir pasti jam device yang
  // belum tersinkron sama sekali (banyak RTC mulai dari 1970 atau 2000).
  @Min(1577836800)
  // Batas atas 1 Januari 2100, sekadar penjaga agar epoch milidetik yang
  // salah kirim (nilainya ~1000x lebih besar) tertolak di sini, bukan menjadi
  // titik data di tahun 57000.
  @Max(4102444800)
  ts!: number;

  @ApiPropertyOptional({
    example: 10432,
    description:
      'Nomor urut payload sejak device booting; reset ke 0 setiap restart. ' +
      'Disimpan untuk diagnosa, TIDAK dipakai sebagai kunci idempotensi justru karena bisa reset.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  seq?: number;

  @ApiPropertyOptional({ example: 3.92, description: 'Tegangan baterai (volt).' })
  @IsOptional()
  @IsNumber({ allowInfinity: false, allowNaN: false })
  battery_v?: number;

  @ApiPropertyOptional({ example: -71, description: 'Kekuatan sinyal (dBm), biasanya negatif.' })
  @IsOptional()
  @IsInt()
  rssi?: number;

  @ApiProperty({
    type: [SensorReadingItemDto],
    description:
      'Daftar pembacaan sensor. Panjangnya BOLEH berubah-ubah: sensor yang sedang error ' +
      'tidak ikut dikirim, dan array kosong pun diterima (dicatat sebagai bukti device hidup ' +
      'tanpa sensor yang berfungsi).',
  })
  @IsArray()
  @ArrayMinSize(0)
  @ValidateNested({ each: true })
  @Type(() => SensorReadingItemDto)
  readings!: SensorReadingItemDto[];
}

export class IngestTelemetryDto extends TelemetrySampleDto {
  @ApiProperty({
    example: 'WS-GRT-001',
    description:
      'Kode device. Wajib cocok dengan device pemilik kredensial pada header X-Device-Key; ' +
      'kalau tidak cocok, request ditolak 403 DEVICE_MISMATCH.',
  })
  @IsString()
  @MaxLength(64)
  device_id!: string;

  @ApiPropertyOptional({ example: '1.4.2', description: 'Versi firmware.' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  fw?: string;
}

export class IngestTelemetryBatchDto {
  @ApiProperty({ example: 'WS-GRT-001' })
  @IsString()
  @MaxLength(64)
  device_id!: string;

  @ApiPropertyOptional({ example: '1.4.2' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  fw?: string;

  @ApiProperty({
    type: [TelemetrySampleDto],
    description:
      'Data yang tertahan saat device offline. Batas atasnya diatur environment ' +
      'MAX_BATCH_SIZE (default 500); kelebihan dijawab 413 BATCH_TOO_LARGE. ' +
      'Urutan kedatangan tidak harus kronologis — server yang mengurutkannya.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TelemetrySampleDto)
  batch!: TelemetrySampleDto[];
}

export class IngestHeartbeatDto {
  @ApiProperty({ example: 'WS-GRT-001' })
  @IsString()
  @MaxLength(64)
  device_id!: string;

  @ApiProperty({ example: 1757308920, description: 'Unix epoch detik, UTC.' })
  @IsInt()
  @Min(1577836800)
  @Max(4102444800)
  ts!: number;

  @ApiPropertyOptional({ example: '1.4.2' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  fw?: string;

  @ApiPropertyOptional({ example: 3.9 })
  @IsOptional()
  @IsNumber({ allowInfinity: false, allowNaN: false })
  battery_v?: number;

  @ApiPropertyOptional({ example: -70 })
  @IsOptional()
  @IsInt()
  rssi?: number;

  @ApiPropertyOptional({
    example: 864321,
    description:
      'Lama device menyala dalam detik. Nilai kecil setelah masa senyap adalah bukti ' +
      'device baru restart — inilah yang membedakan "perangkat mati" dari "jaringan putus".',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  uptime_s?: number;
}
