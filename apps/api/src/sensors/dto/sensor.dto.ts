import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SensorStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateSensorTypeDto {
  @ApiProperty({ example: 'soil_moisture' })
  @IsString()
  @MaxLength(32)
  @Matches(/^[a-z0-9_]+$/, { message: 'key hanya boleh huruf kecil, angka, dan garis bawah' })
  key!: string;

  @ApiProperty({ example: 'Kelembapan Tanah' })
  @IsString()
  @MaxLength(80)
  display_name!: string;

  @ApiProperty({ example: '%' })
  @IsString()
  @MaxLength(16)
  unit!: string;

  @ApiProperty({ example: 0 })
  @IsNumber()
  min_valid!: number;

  @ApiProperty({ example: 100 })
  @IsNumber()
  max_valid!: number;

  @ApiPropertyOptional({ default: 2 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  precision: number = 2;

  @ApiPropertyOptional({
    default: false,
    description:
      'True untuk pencacah yang hanya naik dan direset saat restart, seperti rain_counter. ' +
      'Flag inilah yang membuat lapisan agregasi memakai jumlah delta, bukan rata-rata.',
  })
  @IsOptional()
  @IsBoolean()
  is_cumulative: boolean = false;

  @ApiPropertyOptional({ description: 'Konversi satu cacahan ke satuan fisik. rain_counter: 0.2' })
  @IsOptional()
  @IsNumber()
  unit_per_count?: number;

  @ApiPropertyOptional({
    default: false,
    description:
      'True untuk besaran melingkar seperti arah angin, yang rata-ratanya harus dihitung ' +
      'sebagai vektor, bukan aritmetika.',
  })
  @IsOptional()
  @IsBoolean()
  is_circular: boolean = false;
}

export class CreateSensorDto {
  @ApiProperty({ example: 'TEMP-SN-0042' })
  @IsString()
  @MaxLength(64)
  serial_number!: string;

  @ApiProperty({ example: 'temp_air', description: 'Kunci tipe sensor yang sudah terdaftar.' })
  @IsString()
  sensor_type!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  manufacturer?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  model?: string;
}

export class UpdateSensorDto {
  @ApiPropertyOptional({ enum: SensorStatus })
  @IsOptional()
  @IsEnum(SensorStatus)
  status?: SensorStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  manufacturer?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  model?: string;
}

export class InstallSensorDto {
  @ApiProperty({ description: 'UUID sensor fisik yang akan dipasang.' })
  @IsUUID()
  sensor_id!: string;

  @ApiPropertyOptional({
    default: 0,
    description:
      'Membedakan dua sensor bertipe sama pada satu device, misalnya suhu dalam dan luar ' +
      'ruangan. Device mengirimnya sebagai akhiran, contoh "temp_air:1".',
  })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? 0 : Number.parseInt(String(value), 10)))
  @IsInt()
  @Min(0)
  @Max(32767)
  channel: number = 0;

  @ApiPropertyOptional({
    description:
      'Waktu pemasangan, ISO 8601 UTC. Default sekarang. Boleh diisi mundur untuk mencatat ' +
      'pemasangan yang sudah terjadi, selama tidak tumpang tindih dengan pemasangan lain.',
  })
  @IsOptional()
  @IsISO8601()
  installed_at?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  notes?: string;
}

export class UninstallSensorDto {
  @ApiPropertyOptional({ description: 'Waktu pelepasan, ISO 8601 UTC. Default sekarang.' })
  @IsOptional()
  @IsISO8601()
  removed_at?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  notes?: string;
}

export class CreateCalibrationDto {
  @ApiPropertyOptional({ default: 0, description: 'Koreksi pergeseran titik nol.' })
  @IsOptional()
  @IsNumber()
  offset: number = 0;

  @ApiPropertyOptional({ default: 1, description: 'Koreksi sensitivitas.' })
  @IsOptional()
  @IsNumber()
  scale: number = 1;

  @ApiPropertyOptional({
    description:
      'Mulai berlaku, ISO 8601 UTC. Default sekarang. Kalibrasi yang sedang berlaku otomatis ' +
      'ditutup pada waktu ini, sehingga masa berlakunya tidak pernah tumpang tindih.',
  })
  @IsOptional()
  @IsISO8601()
  effective_from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  notes?: string;
}
