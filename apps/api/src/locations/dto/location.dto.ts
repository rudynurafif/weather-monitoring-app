import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * Lokasi pemasangan stasiun.
 *
 * Dipisahkan dari `device` karena keduanya berumur berbeda: perangkat bisa
 * rusak dan diganti, sementara lokasinya tetap. Kalau koordinat disimpan di
 * tabel device, mengganti perangkat di tiang yang sama akan menghasilkan dua
 * baris lokasi yang sebenarnya satu tempat — dan perbandingan historis antar
 * tahun di situs itu ikut pecah.
 */
export class CreateLocationDto {
  @ApiProperty({ example: 'Garut Selatan' })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiProperty({
    example: -7.214,
    description: 'Lintang dalam derajat desimal. Negatif untuk belahan bumi selatan.',
  })
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(-90)
  @Max(90)
  latitude!: number;

  @ApiProperty({
    example: 107.9,
    description: 'Bujur dalam derajat desimal. Positif untuk belahan bumi timur.',
  })
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(-180)
  @Max(180)
  longitude!: number;

  @ApiProperty({
    example: 717,
    description:
      'Ketinggian di atas permukaan laut, dalam meter. Dipakai menafsirkan tekanan udara ' +
      'dan suhu — tiap naik 1000 m, suhu turun sekitar 6,5 derajat.',
  })
  @IsNumber({ allowInfinity: false, allowNaN: false })
  // Batas bawah mengakomodasi lokasi di bawah permukaan laut seperti Laut Mati
  // (-430 m); batas atas di atas puncak tertinggi dunia.
  @Min(-500)
  @Max(9000)
  altitude_m!: number;

  @ApiPropertyOptional({ example: 'Halaman kantor BPP Kecamatan' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;
}

export class UpdateLocationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(-180)
  @Max(180)
  longitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(-500)
  @Max(9000)
  altitude_m?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;
}

/**
 * Parameter daftar lokasi.
 *
 * Lokasi berjumlah kecil — puluhan, bukan jutaan — tetapi tetap dipaginasi
 * supaya kontraknya sama dengan seluruh endpoint list lain: klien tidak perlu
 * menghafal endpoint mana yang mengirim `meta.pagination` dan mana yang tidak.
 * Karena itu `per_page` default-nya 50, cukup untuk memuat seluruh pilihan di
 * satu dropdown tanpa permintaan kedua.
 */
export class ListLocationsDto {
  @ApiPropertyOptional({ description: 'Pencarian bebas pada nama lokasi.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Transform(({ value }) => Number.parseInt(String(value), 10))
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Transform(({ value }) => Number.parseInt(String(value), 10))
  @IsInt()
  @Min(1)
  @Max(200)
  per_page: number = 50;
}
