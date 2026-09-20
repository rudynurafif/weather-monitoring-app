import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { DeviceAuthGuard, type RequestWithDevice } from '../auth/device-auth.guard';
import { ApiException } from '../common/errors/api.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { DeviceRateLimitGuard } from './device-rate-limit.guard';
import { IngestHeartbeatDto, IngestTelemetryBatchDto, IngestTelemetryDto } from './dto/ingest.dto';
import { IngestionService, type IngestResult } from './ingestion.service';

/**
 * Endpoint yang dipanggil device.
 *
 * Urutan guard-nya penting: autentikasi lebih dulu, baru rate limit — karena
 * kunci rate limit adalah identitas device yang baru diketahui setelah
 * kredensialnya terbukti sah.
 */
@ApiTags('ingestion')
@ApiSecurity('device-key')
@Controller('ingest')
@UseGuards(DeviceAuthGuard, DeviceRateLimitGuard)
export class IngestionController {
  constructor(private readonly ingestion: IngestionService) {}

  @Post('telemetry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Terima satu payload pembacaan',
    description:
      'Format payload mengikuti spesifikasi firmware (Bagian F.1) dan tidak diubah. ' +
      'Pengiriman ulang payload yang sama dijawab 200 dengan accepted 0 dan duplicated sesuai jumlahnya.',
  })
  @ApiResponse({ status: 200, description: 'Seluruh pembacaan diterima atau sudah ada sebelumnya' })
  @ApiResponse({ status: 207, description: 'Sebagian diterima, sebagian ditolak' })
  @ApiResponse({ status: 401, description: 'Kredensial device tidak valid' })
  @ApiResponse({ status: 403, description: 'device_id tidak cocok dengan kredensial' })
  @ApiResponse({ status: 422, description: 'Seluruh record ditolak' })
  @ApiResponse({ status: 429, description: 'Melampaui kuota request per menit' })
  async telemetry(
    @Req() request: RequestWithDevice,
    @Res({ passthrough: true }) response: Response,
    @Body() dto: IngestTelemetryDto,
  ): Promise<IngestResult> {
    const result = await this.ingestion.ingestSingle(request.device!, dto);
    return this.applyStatus(response, result);
  }

  @Post('telemetry/batch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Terima banyak payload sekaligus (data buffered)',
    description:
      'Setiap record berdiri sendiri: batch yang separuh isinya duplikat tetap menyimpan ' +
      'separuh yang baru, sehingga device tidak perlu tahu bagian mana yang sudah sampai.',
  })
  @ApiResponse({ status: 200, description: 'Seluruh record diterima atau sudah ada sebelumnya' })
  @ApiResponse({ status: 207, description: 'Sebagian diterima, sebagian ditolak' })
  @ApiResponse({ status: 413, description: 'Jumlah record melebihi MAX_BATCH_SIZE' })
  @ApiResponse({ status: 503, description: 'Database tidak tersedia, kirim ulang nanti' })
  async telemetryBatch(
    @Req() request: RequestWithDevice,
    @Res({ passthrough: true }) response: Response,
    @Body() dto: IngestTelemetryBatchDto,
  ): Promise<IngestResult> {
    const result = await this.ingestion.ingestBatch(request.device!, dto);
    return this.applyStatus(response, result);
  }

  @Post('heartbeat')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Laporan kesehatan device tanpa data sensor',
    description:
      'Membuktikan device hidup sekalipun seluruh sensornya sedang gagal — inilah yang ' +
      'membedakan "perangkat mati" dari "perangkat hidup tapi sensornya rusak".',
  })
  async heartbeat(
    @Req() request: RequestWithDevice,
    @Body() dto: IngestHeartbeatDto,
  ): Promise<{ device_time: string; server_time: string }> {
    return this.ingestion.ingestHeartbeat(request.device!, dto);
  }

  /**
   * Menentukan status HTTP dari hasil pemrosesan.
   *
   * Aturannya:
   *  - ada yang ditolak DAN ada yang berhasil  -> 207 Multi-Status
   *  - SEMUA ditolak                           -> 422 Unprocessable Entity
   *  - selebihnya                              -> 200 OK
   *
   * Duplikat TIDAK dihitung sebagai kegagalan. Justru sebaliknya: device
   * mengirim ulang karena tidak menerima ACK, dan yang dibutuhkannya sekarang
   * adalah jawaban 2xx supaya berhenti mengulang. Menjawab 4xx untuk duplikat
   * akan membuat device mengulang selamanya.
   */
  private applyStatus(response: Response, result: IngestResult): IngestResult {
    const succeeded = result.accepted + result.duplicated;

    if (result.rejected > 0 && succeeded === 0) {
      throw new ApiException(
        ErrorCode.VALIDATION_FAILED,
        'Seluruh record dalam payload ditolak',
        HttpStatus.UNPROCESSABLE_ENTITY,
        result.errors.map((error) => ({
          field: error.sensor ? `batch[${error.index}].${error.sensor}` : `batch[${error.index}]`,
          code: error.code,
          message: error.message,
        })),
      );
    }

    if (result.rejected > 0) {
      response.status(HttpStatus.MULTI_STATUS);
    }

    return result;
  }
}
