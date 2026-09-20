import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { buildRecomputeSql, type MaterializedBucketWidth } from './recompute-buckets';

/**
 * Worker agregasi: menghabiskan antrean bucket kotor secara berkala.
 *
 * Berjalan DI LUAR jalur request. Ingestion hanya menandai bucket yang
 * tersentuh lalu langsung menjawab device; pekerjaan beratnya terjadi di sini.
 * Akibatnya lonjakan ingestion tidak ikut memperlambat respons ke device, dan
 * data yang terlambat tetap memperbaiki agregat lama tanpa perlakuan khusus.
 *
 * Memakai setInterval biasa, bukan @nestjs/schedule, supaya tidak menambah
 * dependensi untuk satu tugas periodik. `unref()` dipasang agar timer ini
 * tidak menahan proses tetap hidup saat shutdown.
 */
@Injectable()
export class AggregationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AggregationService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  /** Jeda antar putaran. Cukup rapat agar dashboard terasa hidup. */
  private static readonly INTERVAL_MS = 15_000;

  /** Batas bucket per putaran, supaya satu transaksi tidak berjalan lama. */
  private static readonly BATCH_LIMIT = 1_000;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.drain();
    }, AggregationService.INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  /**
   * Menghitung ulang bucket yang tertunda.
   *
   * Penjaga `running` mencegah dua putaran tumpang tindih kalau satu putaran
   * ternyata lebih lama daripada intervalnya.
   */
  async drain(): Promise<{ processed: number }> {
    if (this.running) {
      return { processed: 0 };
    }

    this.running = true;
    let processed = 0;

    try {
      for (const width of ['HOUR_1', 'DAY_1'] as MaterializedBucketWidth[]) {
        // Beberapa putaran per lebar bucket, supaya antrean besar hasil data
        // buffered ikut terkejar dalam satu siklus.
        for (let pass = 0; pass < 5; pass += 1) {
          const before = await this.prisma.aggregateDirtyBucket.count({
            where: { bucketWidth: width },
          });

          if (before === 0) {
            break;
          }

          await this.prisma.$executeRaw(
            buildRecomputeSql(width, AggregationService.BATCH_LIMIT),
          );

          const after = await this.prisma.aggregateDirtyBucket.count({
            where: { bucketWidth: width },
          });

          processed += before - after;

          // Kalau satu putaran tidak mengurangi antrean sama sekali, berhenti
          // daripada berputar tanpa kemajuan.
          if (after >= before) {
            break;
          }
        }
      }
    } catch (error) {
      // Kegagalan agregasi tidak boleh menjatuhkan proses: data mentahnya
      // aman, penandanya masih ada, dan putaran berikutnya akan mencoba lagi.
      this.logger.error(`Putaran agregasi gagal: ${String(error)}`);
    } finally {
      this.running = false;
    }

    if (processed > 0) {
      this.logger.log(`Agregat diperbarui: ${processed} bucket`);
    }

    return { processed };
  }
}
