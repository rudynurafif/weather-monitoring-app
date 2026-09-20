import { Controller, Get, HttpStatus, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ApiException } from '../common/errors/api.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { QueryReadingsDto } from './dto/query-readings.dto';
import { ReadingsService } from './readings.service';

@ApiTags('readings')
@Controller()
export class ReadingsController {
  constructor(private readonly readingsService: ReadingsService) {}

  @Get('readings')
  @ApiOperation({
    summary: 'Deret waktu untuk chart',
    description:
      'Response memakai format kolom terpisah demi efisiensi payload. Server berhak ' +
      'menaikkan resolusi secara paksa bila rentang terlalu lebar; nilai yang dipakai ' +
      'dilaporkan di meta.interval_applied.',
  })
  async timeSeries(@Query() query: QueryReadingsDto) {
    return this.readingsService.queryReadings(query);
  }

  @Get('readings/summary')
  @ApiOperation({
    summary: 'Ringkasan harian',
    description:
      'Suhu min/maks/rata-rata, total curah hujan, dan kecepatan angin maksimum per hari. ' +
      'Batas harinya mengikuti tengah malam WIB, bukan UTC.',
  })
  @ApiQuery({ name: 'device_id', required: true })
  @ApiQuery({ name: 'from', required: true, example: '2026-09-14T00:00:00Z' })
  @ApiQuery({ name: 'to', required: true, example: '2026-09-21T00:00:00Z' })
  async summary(
    @Query('device_id') deviceId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    const fromDate = new Date(from);
    const toDate = new Date(to);

    if (!deviceId || Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      throw new ApiException(
        ErrorCode.VALIDATION_FAILED,
        'Parameter device_id, from, dan to wajib diisi dengan nilai yang valid',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    // Ringkasan membaca data mentah, jadi rentangnya dibatasi lebih ketat
    // daripada endpoint chart yang dilayani dari agregat.
    if (toDate.getTime() - fromDate.getTime() > 92 * 86_400_000) {
      throw new ApiException(
        ErrorCode.INVALID_TIME_RANGE,
        'Rentang ringkasan maksimum 92 hari',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    return this.readingsService.dailySummary(deviceId, fromDate, toDate);
  }

  @Get('devices/:id/readings/latest')
  @ApiOperation({
    summary: 'Nilai terkini seluruh sensor pada satu device',
    description:
      'Dilayani lewat DISTINCT ON sehingga berhenti pada baris pertama tiap sensor, ' +
      'bukan memindai rentang waktu.',
  })
  async latest(@Param('id') deviceId: string) {
    return this.readingsService.latestForDevice(deviceId);
  }

  @Get('dashboard/overview')
  @ApiOperation({
    summary: 'Ringkasan seluruh stasiun untuk halaman utama',
    description:
      'Satu query dengan LATERAL JOIN untuk semua device, bukan satu query per device. ' +
      'Status koneksi (ONLINE/SILENT/OFFLINE) diturunkan di server.',
  })
  async overview() {
    return this.readingsService.dashboardOverview();
  }
}
