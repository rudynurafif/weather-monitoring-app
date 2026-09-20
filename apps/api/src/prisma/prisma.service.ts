import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Satu-satunya pintu ke database.
 *
 * Koneksi dibuka saat modul start dan ditutup rapi saat proses berhenti, supaya
 * `docker compose down` tidak meninggalkan koneksi menggantung di PostgreSQL.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Terhubung ke database');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Menandai apakah sebuah error berasal dari database yang tidak bisa dihubungi.
   *
   * Dipakai jalur ingestion untuk membedakan "payload-nya bermasalah" (yang
   * jawabannya 4xx dan device TIDAK boleh mengirim ulang) dari "kami yang
   * sedang bermasalah" (503, dan device HARUS mengirim ulang). Lihat
   * docs/DATA-FLOW.md bagian D.6.
   */
  static isConnectionError(error: unknown): boolean {
    const code = (error as { code?: string })?.code;
    // P1001 tidak bisa menjangkau server, P1002 timeout, P1008 timeout operasi,
    // P1017 server menutup koneksi, P2024 kehabisan koneksi di pool.
    return ['P1001', 'P1002', 'P1008', 'P1017', 'P2024'].includes(code ?? '');
  }
}
