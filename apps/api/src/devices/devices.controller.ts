import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DevicesService } from './devices.service';
import { CreateDeviceDto, ListDevicesDto, UpdateDeviceDto } from './dto/device.dto';

@ApiTags('devices')
@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Mendaftarkan device baru',
    description:
      'Membuat device beserta kredensial pertamanya. Nilai device_key dikembalikan ' +
      'HANYA sekali di response ini dan tidak pernah bisa dibaca lagi.',
  })
  @ApiResponse({ status: 201, description: 'Device dibuat, kredensial disertakan' })
  @ApiResponse({ status: 409, description: 'device_code sudah terdaftar' })
  create(@Body() dto: CreateDeviceDto) {
    return this.devices.create(dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Daftar device',
    description:
      'Pagination offset-based. Filter: status, location_id, dan pencarian bebas q ' +
      'pada kode maupun nama device.',
  })
  list(@Query() dto: ListDevicesDto) {
    return this.devices.list(dto);
  }

  @Get('silent')
  @ApiOperation({
    summary: 'Device yang tidak mengirim data lebih dari X menit',
    description:
      'Menjawab pertanyaan heartbeat di Bagian A.4. Dilayani dari kolom last_seen_at ' +
      'yang didenormalisasi, sehingga tidak menyentuh tabel time-series sama sekali.',
  })
  silent(@Query('minutes') minutes?: string) {
    const parsed = Number.parseInt(minutes ?? '15', 10);
    return this.devices.silentDevices(Number.isFinite(parsed) ? parsed : 15);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detail device beserta sensor terpasang dan riwayat status' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.devices.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Memperbarui device',
    description:
      'Perubahan status divalidasi terhadap daftar transisi yang diizinkan dan selalu ' +
      'tercatat di device_status_history.',
  })
  @ApiResponse({ status: 409, description: 'Transisi status tidak diizinkan' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDeviceDto) {
    return this.devices.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Menghapus device (soft delete)',
    description:
      'Barisnya tidak pernah benar-benar dihapus karena masih menjadi induk jutaan ' +
      'pembacaan historis. Data historis tetap utuh dan tetap bisa di-query.',
  })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.devices.softDelete(id);
  }

  @Post(':id/credentials/rotate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Merotasi kredensial device',
    description:
      'Kredensial lama tetap diterima selama masa tenggang 7 hari, agar device yang ' +
      'sedang offline saat rotasi tidak terkunci di luar sistem.',
  })
  rotate(@Param('id', ParseUUIDPipe) id: string) {
    return this.devices.rotateCredentials(id);
  }

  @Get(':id/health')
  @ApiOperation({ summary: 'Kesehatan device: baterai, sinyal, dan berapa lama ia diam' })
  health(@Param('id', ParseUUIDPipe) id: string) {
    return this.devices.health(id);
  }
}
