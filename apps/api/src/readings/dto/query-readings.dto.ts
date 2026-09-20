import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsISO8601, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * Resolusi yang bisa diminta klien.
 *
 * `raw` mengembalikan pembacaan apa adanya; sisanya dilayani dari agregat.
 * `1m` tidak dimaterialisasi (lihat docs/ERD.md §5) dan dihitung saat diminta
 * dengan `time_bucket` — murah karena rentangnya selalu pendek.
 */
export enum ReadingInterval {
  RAW = 'raw',
  MINUTE_1 = '1m',
  HOUR_1 = '1h',
  DAY_1 = '1d',
}

export enum ReadingAgg {
  AVG = 'avg',
  MIN = 'min',
  MAX = 'max',
  SUM = 'sum',
}

export class QueryReadingsDto {
  @ApiPropertyOptional({ description: 'UUID device. Wajib diisi.' })
  @IsString()
  device_id!: string;

  @ApiPropertyOptional({ example: 'temp_air', description: 'Kunci tipe sensor. Wajib diisi.' })
  @IsString()
  sensor_type!: string;

  @ApiPropertyOptional({ example: 0, description: 'Channel sensor. Default 0.' })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? 0 : Number.parseInt(String(value), 10)))
  @IsInt()
  @Min(0)
  @Max(32767)
  channel: number = 0;

  @ApiPropertyOptional({ example: '2026-09-14T00:00:00Z', description: 'Batas bawah, ISO 8601 UTC.' })
  @IsISO8601()
  from!: string;

  @ApiPropertyOptional({ example: '2026-09-21T00:00:00Z', description: 'Batas atas, ISO 8601 UTC.' })
  @IsISO8601()
  to!: string;

  @ApiPropertyOptional({
    enum: ReadingInterval,
    description:
      'Resolusi yang diminta. Server BOLEH menaikkannya secara paksa bila rentang waktunya ' +
      'terlalu lebar; nilai yang benar-benar dipakai dilaporkan di meta.interval_applied.',
  })
  @IsOptional()
  @IsEnum(ReadingInterval)
  interval: ReadingInterval = ReadingInterval.RAW;

  @ApiPropertyOptional({
    enum: ReadingAgg,
    description:
      'Fungsi agregasi untuk kolom nilai utama. Diabaikan untuk interval raw. ' +
      'Untuk sensor kumulatif seperti curah hujan, nilainya selalu berupa jumlah delta.',
  })
  @IsOptional()
  @IsEnum(ReadingAgg)
  agg: ReadingAgg = ReadingAgg.AVG;
}
