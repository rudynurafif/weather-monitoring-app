import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DeviceStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
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
  ValidateNested,
} from 'class-validator';
import { CreateLocationDto } from '../../locations/dto/location.dto';

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

  /**
   * Lokasi device ditentukan lewat SALAH SATU dari dua field berikut.
   *
   * Dua jalan disediakan karena dua keadaan lapangan yang sama-sama nyata:
   *
   *  - Stasiun baru di tempat baru — operator mengisi koordinat dan ketinggian
   *    langsung di form yang sama. Memaksanya membuat lokasi lebih dulu di
   *    halaman terpisah hanya menambah langkah tanpa menambah ketelitian.
   *  - Perangkat pengganti di tiang yang sama — operator memilih lokasi yang
   *    sudah ada. Ini justru kasus yang paling penting: data lama dan data baru
   *    harus menunjuk satu lokasi yang sama agar perbandingan antar tahun di
   *    situs itu tetap sahih.
   */
  @ApiPropertyOptional({
    description:
      'UUID lokasi yang sudah terdaftar. Pakai ini saat memasang perangkat pengganti ' +
      'di lokasi yang sudah ada. Tidak boleh diisi bersamaan dengan `location`.',
  })
  @IsOptional()
  @IsUUID()
  location_id?: string;

  @ApiPropertyOptional({
    type: CreateLocationDto,
    description:
      'Lokasi baru yang dibuat sekaligus dengan device-nya, dalam satu transaksi. ' +
      'Tidak boleh diisi bersamaan dengan `location_id`.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateLocationDto)
  location?: CreateLocationDto;

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
