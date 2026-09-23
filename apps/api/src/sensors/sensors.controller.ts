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
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CreateCalibrationDto,
  CreateSensorDto,
  CreateSensorTypeDto,
  InstallSensorDto,
  UninstallSensorDto,
  UpdateSensorDto,
} from './dto/sensor.dto';
import { SensorsService } from './sensors.service';

@ApiTags('sensors')
@Controller()
export class SensorsController {
  constructor(private readonly sensors: SensorsService) {}

  // --- Tipe sensor ---------------------------------------------------

  @Get('sensor-types')
  @ApiOperation({ summary: 'Daftar tipe sensor beserta satuan dan rentang validnya' })
  listSensorTypes(@Query('page') page?: string, @Query('per_page') perPage?: string) {
    return this.sensors.listSensorTypes(
      Math.max(1, Number.parseInt(page ?? '1', 10) || 1),
      Math.min(200, Math.max(1, Number.parseInt(perPage ?? '50', 10) || 50)),
    );
  }

  @Post('sensor-types')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Mendaftarkan tipe sensor baru',
    description:
      'Menambah tipe sensor TIDAK memerlukan perubahan skema sama sekali — konsekuensi ' +
      'langsung dari menyimpan pembacaan dalam format narrow.',
  })
  createSensorType(@Body() dto: CreateSensorTypeDto) {
    return this.sensors.createSensorType(dto);
  }

  // --- Sensor fisik --------------------------------------------------

  @Get('sensors')
  @ApiOperation({ summary: 'Daftar sensor fisik beserta lokasi pemasangannya saat ini' })
  listSensors(
    @Query('page') page?: string,
    @Query('per_page') perPage?: string,
    @Query('sensor_type') sensorType?: string,
  ) {
    return this.sensors.listSensors(
      Math.max(1, Number.parseInt(page ?? '1', 10) || 1),
      Math.min(100, Math.max(1, Number.parseInt(perPage ?? '20', 10) || 20)),
      sensorType,
    );
  }

  @Post('sensors')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Mendaftarkan sensor fisik baru (belum terpasang)' })
  createSensor(@Body() dto: CreateSensorDto) {
    return this.sensors.createSensor(dto);
  }

  @Patch('sensors/:id')
  @ApiOperation({ summary: 'Memperbarui data sensor' })
  updateSensor(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSensorDto) {
    return this.sensors.updateSensor(id, dto);
  }

  @Delete('sensors/:id')
  @ApiOperation({
    summary: 'Menghapus sensor (soft delete)',
    description: 'Ditolak bila sensornya masih terpasang di sebuah device.',
  })
  deleteSensor(@Param('id', ParseUUIDPipe) id: string) {
    return this.sensors.deleteSensor(id);
  }

  // --- Pemasangan ----------------------------------------------------

  @Post('devices/:id/sensors')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Memasang sensor ke device',
    description:
      'Membuat baris riwayat baru, tidak mengubah baris lama. Data historis tetap terikat ' +
      'pada device tempat sensor berada saat pengukurannya terjadi.',
  })
  install(@Param('id', ParseUUIDPipe) deviceId: string, @Body() dto: InstallSensorDto) {
    return this.sensors.installSensor(deviceId, dto);
  }

  @Delete('devices/:id/sensors/:sensorId')
  @ApiOperation({
    summary: 'Melepas sensor dari device',
    description: 'Menutup baris pemasangan dengan removed_at; barisnya tidak pernah dihapus.',
  })
  uninstall(
    @Param('id', ParseUUIDPipe) deviceId: string,
    @Param('sensorId', ParseUUIDPipe) sensorId: string,
    @Body() dto: UninstallSensorDto,
  ) {
    return this.sensors.uninstallSensor(deviceId, sensorId, dto ?? {});
  }

  // --- Kalibrasi -----------------------------------------------------

  @Get('sensors/:id/installations')
  @ApiOperation({
    summary: 'Riwayat pemasangan sensor',
    description:
      'Sensor ini pernah terpasang di device mana saja, sejak kapan sampai kapan. ' +
      'removed_at bernilai null berarti pemasangan yang sedang berlaku.',
  })
  listInstallations(@Param('id', ParseUUIDPipe) id: string) {
    return this.sensors.listInstallations(id);
  }

  @Get('sensors/:id/calibrations')
  @ApiOperation({ summary: 'Riwayat kalibrasi sebuah sensor' })
  listCalibrations(@Param('id', ParseUUIDPipe) sensorId: string) {
    return this.sensors.listCalibrations(sensorId);
  }

  @Post('sensors/:id/calibrations')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Menambah kalibrasi baru',
    description:
      'Kalibrasi yang sedang berlaku otomatis ditutup pada waktu mulai yang baru. ' +
      'Data lama TIDAK dihitung ulang — lihat JAWABAN.md bagian B.',
  })
  createCalibration(
    @Param('id', ParseUUIDPipe) sensorId: string,
    @Body() dto: CreateCalibrationDto,
  ) {
    return this.sensors.createCalibration(sensorId, dto);
  }
}
