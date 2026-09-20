import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { EffectiveCalibration } from './domain/calibration';
import type { SensorTypeSpec } from './domain/evaluate-reading';

/**
 * Menyediakan data master yang dibutuhkan jalur ingestion: tipe sensor,
 * pemasangan yang berlaku, dan kalibrasi yang berlaku.
 *
 * Prinsip yang dipegang seluruh berkas ini: **jumlah query per request harus
 * tetap, tidak boleh tumbuh mengikuti jumlah record dalam batch.** Batch berisi
 * 500 record yang memicu 500 lookup akan meruntuhkan ingestion justru pada saat
 * paling genting — ketika puluhan device serentak mengirim data buffered
 * setelah listrik pulih.
 *
 * Karena itu semuanya diambil sekali secara borongan, lalu pencocokan
 * per-record dilakukan di memori.
 */

/** Slot sensor pada sebuah device: kombinasi tipe sensor dan channel. */
export interface SensorSlot {
  sensorTypeId: number;
  channel: number;
}

export interface ResolvedInstallation {
  installationId: string;
  sensorId: string;
  installedAt: Date;
  removedAt: Date | null;
}

interface InstallationRow extends ResolvedInstallation {
  sensorTypeId: number;
  channel: number;
}

const SENSOR_TYPE_CACHE_TTL_MS = 60_000;

@Injectable()
export class ReferenceDataService {
  private sensorTypeCache: Map<string, SensorTypeSpec> | null = null;
  private sensorTypeCacheExpiry = 0;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Tipe sensor, di-cache di memori proses selama 60 detik.
   *
   * Isinya master data yang praktis tidak pernah berubah — tujuh baris yang
   * dibaca untuk SETIAP pembacaan yang masuk. Tanpa cache, 350 pembacaan per
   * menit berarti 350 query yang jawabannya selalu identik.
   *
   * TTL 60 detik dipilih, bukan cache permanen, supaya perubahan master data
   * (misalnya rentang valid yang disesuaikan operator) ikut berlaku tanpa
   * perlu me-restart API. Konsekuensi yang diterima: ada jendela paling lama
   * satu menit di mana beberapa instance API bisa memakai rentang berbeda.
   * Untuk data yang jarang berubah, itu pertukaran yang wajar.
   */
  async getSensorTypesByKey(): Promise<Map<string, SensorTypeSpec>> {
    if (this.sensorTypeCache && Date.now() < this.sensorTypeCacheExpiry) {
      return this.sensorTypeCache;
    }

    const rows = await this.prisma.sensorType.findMany({
      select: {
        id: true,
        key: true,
        minValid: true,
        maxValid: true,
        isCumulative: true,
        unitPerCount: true,
        isCircular: true,
      },
    });

    this.sensorTypeCache = new Map(rows.map((row) => [row.key, row]));
    this.sensorTypeCacheExpiry = Date.now() + SENSOR_TYPE_CACHE_TTL_MS;

    return this.sensorTypeCache;
  }

  /** Dipanggil setelah tipe sensor diubah lewat API, agar perubahan langsung berlaku. */
  invalidateSensorTypeCache(): void {
    this.sensorTypeCache = null;
    this.sensorTypeCacheExpiry = 0;
  }

  /**
   * Mengambil SEMUA pemasangan pada satu device yang bersinggungan dengan
   * rentang waktu sebuah batch — satu query untuk seluruh batch.
   *
   * Syarat bersinggungan: pemasangan dimulai sebelum batch berakhir, dan belum
   * dilepas saat batch dimulai. Pemasangan yang seluruhnya berada di luar
   * rentang batch tidak akan pernah cocok dengan record mana pun, jadi tidak
   * perlu ikut diambil.
   */
  async loadInstallations(
    deviceId: string,
    from: Date,
    to: Date,
  ): Promise<Map<string, InstallationRow[]>> {
    const rows = await this.prisma.sensorInstallation.findMany({
      where: {
        deviceId,
        installedAt: { lte: to },
        OR: [{ removedAt: null }, { removedAt: { gt: from } }],
      },
      select: {
        id: true,
        sensorId: true,
        sensorTypeId: true,
        channel: true,
        installedAt: true,
        removedAt: true,
      },
      orderBy: { installedAt: 'desc' },
    });

    const bySlot = new Map<string, InstallationRow[]>();

    for (const row of rows) {
      const key = slotKey(row.sensorTypeId, row.channel);
      const list = bySlot.get(key) ?? [];
      list.push({
        installationId: row.id,
        sensorId: row.sensorId,
        sensorTypeId: row.sensorTypeId,
        channel: row.channel,
        installedAt: row.installedAt,
        removedAt: row.removedAt,
      });
      bySlot.set(key, list);
    }

    return bySlot;
  }

  /**
   * Mencari pemasangan yang memegang sebuah slot pada satu titik waktu.
   *
   * Pembandingnya `device_time` — waktu pengukuran — bukan waktu sekarang.
   * Inilah yang menjamin data dari 31 Mei tetap menunjuk sensor yang memang
   * terpasang pada 31 Mei, sekalipun sensornya sudah lama pindah ke device
   * lain ketika data itu akhirnya sampai ke server.
   *
   * Rentangnya setengah terbuka: `installed_at <= t < removed_at`, sehingga
   * pelepasan dan pemasangan yang terjadi pada detik yang sama tidak pernah
   * berebut satu titik waktu.
   */
  static resolveInstallationAt(
    installations: readonly InstallationRow[] | undefined,
    at: Date,
  ): ResolvedInstallation | null {
    if (!installations || installations.length === 0) {
      return null;
    }

    const t = at.getTime();

    return (
      installations.find((row) => {
        const from = row.installedAt.getTime();
        const to = row.removedAt === null ? Number.POSITIVE_INFINITY : row.removedAt.getTime();
        return from <= t && t < to;
      }) ?? null
    );
  }

  /**
   * Mengambil seluruh riwayat kalibrasi milik sekumpulan sensor — satu query
   * untuk seluruh batch.
   *
   * Riwayat diambil seluruhnya, bukan hanya yang berlaku sekarang, karena satu
   * batch bisa memuat record dari beberapa periode kalibrasi berbeda.
   * Jumlahnya kecil (hitungan baris per sensor), jadi memuatnya ke memori jauh
   * lebih murah daripada satu query per record.
   */
  async loadCalibrations(
    sensorIds: readonly string[],
  ): Promise<Map<string, EffectiveCalibration[]>> {
    if (sensorIds.length === 0) {
      return new Map();
    }

    const rows = await this.prisma.sensorCalibration.findMany({
      where: { sensorId: { in: [...new Set(sensorIds)] } },
      select: {
        id: true,
        sensorId: true,
        offset: true,
        scale: true,
        effectiveFrom: true,
        effectiveTo: true,
      },
      orderBy: { effectiveFrom: 'desc' },
    });

    const bySensor = new Map<string, EffectiveCalibration[]>();

    for (const row of rows) {
      const list = bySensor.get(row.sensorId) ?? [];
      list.push(row);
      bySensor.set(row.sensorId, list);
    }

    return bySensor;
  }

  /**
   * Nilai pencacah terakhir SEBELUM sebuah titik waktu, untuk setiap slot
   * kumulatif.
   *
   * Dibutuhkan agar record pertama dalam sebuah batch punya acuan — tanpanya,
   * setiap batch akan memulai perhitungan hujan dari nol dan kehilangan satu
   * interval setiap kali device mengirim.
   *
   * Query-nya satu per slot kumulatif, bukan satu per record. Dalam praktiknya
   * hanya ada satu slot kumulatif per device (`rain_counter`), jadi biayanya
   * satu query tambahan untuk seluruh batch.
   */
  async loadPreviousCumulativeValues(
    deviceId: string,
    slots: readonly SensorSlot[],
    before: Date,
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();

    await Promise.all(
      slots.map(async (slot) => {
        const row = await this.prisma.sensorReading.findFirst({
          where: {
            deviceId,
            sensorTypeId: slot.sensorTypeId,
            channel: slot.channel,
            deviceTime: { lt: before },
          },
          select: { rawValue: true },
          orderBy: { deviceTime: 'desc' },
        });

        if (row) {
          result.set(slotKey(slot.sensorTypeId, slot.channel), row.rawValue);
        }
      }),
    );

    return result;
  }
}

/** Kunci gabungan tipe sensor + channel untuk dipakai sebagai key Map. */
export function slotKey(sensorTypeId: number, channel: number): string {
  return `${sensorTypeId}:${channel}`;
}

/**
 * Memisahkan kunci sensor dari payload menjadi tipe dan channel.
 *
 * Firmware yang ada sekarang mengirim `"temp_air"` saja. Akhiran channel
 * (`"temp_air:1"`) disiapkan untuk device yang membawa dua sensor bertipe sama
 * — misalnya suhu dalam dan luar ruangan. Tanpa akhiran berarti channel 0,
 * sehingga firmware lama tetap bekerja tanpa perubahan apa pun.
 */
export function parseSensorKey(raw: string): { key: string; channel: number } {
  const separator = raw.lastIndexOf(':');
  if (separator <= 0) {
    return { key: raw, channel: 0 };
  }

  const channel = Number.parseInt(raw.slice(separator + 1), 10);
  if (!Number.isInteger(channel) || channel < 0 || channel > 32767) {
    // Akhiran yang tidak masuk akal diperlakukan sebagai bagian dari nama,
    // supaya kesalahan ketik berakhir sebagai UNKNOWN_SENSOR_TYPE yang jelas,
    // bukan diam-diam menjadi channel 0 dan bercampur dengan data yang benar.
    return { key: raw, channel: 0 };
  }

  return { key: raw.slice(0, separator), channel };
}
