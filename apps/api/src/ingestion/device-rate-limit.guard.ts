import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { ApiException } from '../common/errors/api.exception';
import { ErrorCode } from '../common/errors/error-codes';
import type { RequestWithDevice } from '../auth/device-auth.guard';

/**
 * Rate limit endpoint ingestion, dengan **device_id sebagai kunci** — bukan IP.
 *
 * Kenapa bukan per IP: stasiun cuaca di lapangan lazimnya berada di belakang
 * NAT operator seluler, sehingga puluhan device bisa berbagi satu alamat IP
 * publik. Membatasi per IP berarti satu device yang cerewet menjatuhkan kuota
 * seluruh device di operator yang sama, sementara penyerang cukup berganti IP
 * untuk lolos. Kuncinya harus identitas yang sudah terbukti — dan itu baru
 * diketahui SETELAH autentikasi, jadi guard ini selalu dipasang sesudah
 * DeviceAuthGuard.
 *
 * Implementasinya sengaja sederhana: sliding window di memori proses.
 * Keterbatasan yang saya sadari dan terima untuk skala ini: kuotanya berlaku
 * per instance API. Kalau kelak dijalankan lebih dari satu instance, hitungannya
 * harus pindah ke penyimpanan bersama (Redis dengan INCR + EXPIRE) agar kuota
 * tidak terkali jumlah instance.
 */
@Injectable()
export class DeviceRateLimitGuard implements CanActivate {
  /** device_id -> daftar waktu request dalam jendela satu menit terakhir. */
  private readonly hits = new Map<string, number[]>();
  private lastSweep = Date.now();

  private static readonly WINDOW_MS = 60_000;
  private static readonly SWEEP_INTERVAL_MS = 300_000;

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithDevice>();
    const device = request.device;

    // Tanpa device berarti guard ini dipasang tanpa DeviceAuthGuard di
    // depannya. Dibiarkan lewat, karena menolak di sini hanya akan
    // menyembunyikan salah pasang guard sebagai error rate limit yang
    // membingungkan.
    if (!device) {
      return true;
    }

    const limit = this.config.get<number>('ingestRateLimitPerMinute') ?? 120;
    const now = Date.now();
    const windowStart = now - DeviceRateLimitGuard.WINDOW_MS;

    const timestamps = (this.hits.get(device.id) ?? []).filter((t) => t > windowStart);

    if (timestamps.length >= limit) {
      const oldest = timestamps[0];
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((oldest + DeviceRateLimitGuard.WINDOW_MS - now) / 1000),
      );

      const response = context.switchToHttp().getResponse<Response>();
      // Header standar agar device tahu HARUS menunggu berapa lama. Tanpa ini,
      // device yang kena limit lazimnya langsung mencoba lagi dan memperburuk
      // keadaan.
      response.setHeader('Retry-After', retryAfterSeconds);
      response.setHeader('X-RateLimit-Limit', limit);
      response.setHeader('X-RateLimit-Remaining', 0);

      throw new ApiException(
        ErrorCode.RATE_LIMIT_EXCEEDED,
        `Device ${device.deviceCode} melampaui ${limit} request per menit; ` +
          `coba lagi dalam ${retryAfterSeconds} detik`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    timestamps.push(now);
    this.hits.set(device.id, timestamps);
    this.sweepIfNeeded(now);

    return true;
  }

  /**
   * Membuang entri device yang sudah lama tidak mengirim.
   *
   * Tanpa ini, Map akan menyimpan satu entri selamanya untuk setiap device yang
   * pernah menyentuh API — kebocoran memori yang lambat tapi pasti. Dijalankan
   * menumpang request biasa setiap lima menit, bukan lewat timer tersendiri,
   * supaya tidak ada interval yang menahan proses tetap hidup saat shutdown.
   */
  private sweepIfNeeded(now: number): void {
    if (now - this.lastSweep < DeviceRateLimitGuard.SWEEP_INTERVAL_MS) {
      return;
    }

    const windowStart = now - DeviceRateLimitGuard.WINDOW_MS;
    for (const [deviceId, timestamps] of this.hits) {
      if (timestamps.every((t) => t <= windowStart)) {
        this.hits.delete(deviceId);
      }
    }

    this.lastSweep = now;
  }
}
