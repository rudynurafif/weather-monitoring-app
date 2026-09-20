import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DeviceStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateDeviceDto {
  @ApiProperty({ example: 'WS-GRT-004' })
  @IsString()
  @MaxLength(64)
  // Dibatasi huruf besar, angka, dan tanda hubung supaya kode device tidak
  // pernah memuat karakter yang menyulitkan saat dipakai di URL atau log.
  @Matches(/^[A-Z0-9-]+$/, {
    message: 'device_code hanya boleh huruf kapital, angka, dan tanda hubung',
  })
  device_code!: string;

  @ApiProperty({ example: 'Stasiun Cuaca Garut Selatan' })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ description: 'UUID lokasi yang sudah terdaftar.' })
  @IsOptional()
  @IsUUID()
  location_id?: string;

  @ApiPropertyOptional({ example: '1.4.2' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  firmware_version?: string;
}

export class UpdateDeviceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  location_id?: string;

  @ApiPropertyOptional({
    enum: DeviceStatus,
    description:
      'Perubahan status divalidasi terhadap daftar transisi yang diizinkan; ' +
      'setiap perubahan dicatat di device_status_history.',
  })
  @IsOptional()
  @IsEnum(DeviceStatus)
  status?: DeviceStatus;

  @ApiPropertyOptional({ description: 'Alasan perubahan status, ikut tercatat di riwayat.' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  status_reason?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  firmware_version?: string;
}

export class ListDevicesDto {
  @ApiPropertyOptional({ enum: DeviceStatus })
  @IsOptional()
  @IsEnum(DeviceStatus)
  status?: DeviceStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  location_id?: string;

  @ApiPropertyOptional({ description: 'Pencarian bebas pada kode dan nama device.' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Transform(({ value }) => Number.parseInt(String(value), 10))
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Transform(({ value }) => Number.parseInt(String(value), 10))
  @IsInt()
  @Min(1)
  @Max(100)
  per_page: number = 20;
}
