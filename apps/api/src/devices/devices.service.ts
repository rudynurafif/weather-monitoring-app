import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CredentialStatus, DeviceStatus, Prisma } from '@prisma/client';
import { generateCredential } from '../auth/device-key.util';
import { ApiException } from '../common/errors/api.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateDeviceDto, ListDevicesDto, UpdateDeviceDto } from './dto/device.dto';

/**
 * Transisi status yang diizinkan (ketentuan A.3).
 *
 * Dinyatakan sebagai data, bukan rangkaian if-else, sehingga aturannya bisa
 * dibaca sekali pandang dan diuji tanpa menjalankan service.
 *
 * DECOMMISSIONED sengaja tidak punya tujuan mana pun: mempensiunkan device
 * bersifat final. Kalau perangkat yang sama dipasang kembali, ia didaftarkan
 * sebagai device baru — dengan begitu data lamanya tetap terikat pada riwayat
 * pemasangan yang benar dan tidak bercampur dengan pemasangan barunya.
 */
const ALLOWED_TRANSITIONS: Record<DeviceStatus, DeviceStatus[]> = {
  PROVISIONED: [DeviceStatus.ACTIVE, DeviceStatus.MAINTENANCE, DeviceStatus.DECOMMISSIONED],
  ACTIVE: [DeviceStatus.MAINTENANCE, DeviceStatus.DECOMMISSIONED],
  MAINTENANCE: [DeviceStatus.ACTIVE, DeviceStatus.DECOMMISSIONED],
  DECOMMISSIONED: [],
};

/** Masa tenggang kredensial lama setelah rotasi. */
const ROTATION_GRACE_DAYS = 7;

@Injectable()
export class DevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Mendaftarkan device baru sekaligus membuat kredensial pertamanya.
   *
   * Nilai secret dikembalikan DI SINI DAN HANYA DI SINI. Tidak ada endpoint
   * lain yang bisa mengeluarkannya lagi, karena yang tersimpan di database
   * hanyalah hash-nya.
   */
  async create(dto: CreateDeviceDto) {
    const existing = await this.prisma.device.findUnique({
      where: { deviceCode: dto.device_code },
    });

    if (existing) {
      throw ApiException.conflict(
        ErrorCode.ALREADY_EXISTS,
        `Device dengan kode "${dto.device_code}" sudah terdaftar`,
      );
    }

    const pepper = this.config.get<string>('deviceKeyPepper') ?? '';
    const credential = generateCredential(pepper);

    const device = await this.prisma.$transaction(async (tx) => {
      const created = await tx.device.create({
        data: {
          deviceCode: dto.device_code,
          name: dto.name,
          locationId: dto.location_id ?? null,
          firmwareVersion: dto.firmware_version ?? null,
          status: DeviceStatus.PROVISIONED,
        },
        include: { location: true },
      });

      await tx.deviceCredential.create({
        data: {
          deviceId: created.id,
          keyId: credential.keyId,
          secretHash: credential.secretHash,
          secretPrefix: credential.secretPrefix,
        },
      });

      // Baris pertama riwayat status, supaya timeline device tidak pernah
      // dimulai dari ketiadaan.
      await tx.deviceStatusHistory.create({
        data: {
          deviceId: created.id,
          fromStatus: null,
          toStatus: DeviceStatus.PROVISIONED,
          reason: 'Device didaftarkan',
        },
      });

      return created;
    });

    return {
      ...serializeDevice(device),
      credential: {
        key_id: credential.keyId,
        // Satu-satunya kemunculan nilai ini sepanjang hidup kredensial.
        device_key: credential.token,
        warning:
          'Simpan device_key sekarang juga. Nilai ini tidak akan pernah ditampilkan lagi; ' +
          'kalau hilang, satu-satunya jalan adalah rotasi kredensial.',
      },
    };
  }

  /**
   * Daftar device dengan filter dan pagination.
   *
   * Memakai pagination OFFSET, bukan cursor. Alasannya dijelaskan di
   * JAWABAN.md bagian E: jumlah device kecil dan stabil, pengguna butuh
   * melompat ke halaman tertentu dan melihat total, sementara kelemahan offset
   * (biaya yang tumbuh pada offset besar, baris bergeser saat data berubah)
   * tidak terasa pada puluhan baris. Untuk time-series, pilihan itu terbalik.
   */
  async list(dto: ListDevicesDto) {
    const where: Prisma.DeviceWhereInput = {
      deletedAt: null,
      ...(dto.status ? { status: dto.status } : {}),
      ...(dto.location_id ? { locationId: dto.location_id } : {}),
      ...(dto.q
        ? {
            OR: [
              { deviceCode: { contains: dto.q, mode: 'insensitive' } },
              { name: { contains: dto.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.device.count({ where }),
      this.prisma.device.findMany({
        where,
        include: { location: true },
        orderBy: { deviceCode: 'asc' },
        skip: (dto.page - 1) * dto.per_page,
        take: dto.per_page,
      }),
    ]);

    return {
      data: rows.map(serializeDevice),
      meta: {
        pagination: {
          page: dto.page,
          per_page: dto.per_page,
          total,
          total_pages: Math.ceil(total / dto.per_page) || 1,
        },
      },
    };
  }

  async findOne(id: string) {
    const device = await this.prisma.device.findFirst({
      where: { id, deletedAt: null },
      include: {
        location: true,
        statusHistory: { orderBy: { changedAt: 'desc' }, take: 10 },
        installations: {
          where: { removedAt: null },
          include: { sensor: true, sensorType: true },
        },
        credentials: {
          where: { status: CredentialStatus.ACTIVE },
          select: { keyId: true, secretPrefix: true, createdAt: true, lastUsedAt: true, expiresAt: true },
        },
      },
    });

    if (!device) {
      throw ApiException.notFound('Device', id);
    }

    return {
      ...serializeDevice(device),
      status_history: device.statusHistory.map((row) => ({
        from_status: row.fromStatus,
        to_status: row.toStatus,
        reason: row.reason,
        changed_at: row.changedAt.toISOString(),
      })),
      sensors: device.installations.map((row) => ({
        installation_id: row.id,
        sensor_id: row.sensorId,
        serial_number: row.sensor.serialNumber,
        sensor_type: row.sensorType.key,
        unit: row.sensorType.unit,
        channel: row.channel,
        installed_at: row.installedAt.toISOString(),
      })),
      credentials: device.credentials.map((row) => ({
        key_id: row.keyId,
        // Hanya awalannya. Nilai penuhnya tidak pernah bisa dibaca lagi.
        secret_preview: `${row.secretPrefix}...`,
        created_at: row.createdAt.toISOString(),
        last_used_at: row.lastUsedAt?.toISOString() ?? null,
        expires_at: row.expiresAt?.toISOString() ?? null,
      })),
    };
  }

  async update(id: string, dto: UpdateDeviceDto) {
    const device = await this.prisma.device.findFirst({ where: { id, deletedAt: null } });
    if (!device) {
      throw ApiException.notFound('Device', id);
    }

    if (dto.status && dto.status !== device.status) {
      this.assertTransitionAllowed(device.status, dto.status);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.device.update({
        where: { id },
        data: {
          name: dto.name,
          locationId: dto.location_id,
          firmwareVersion: dto.firmware_version,
          status: dto.status,
        },
        include: { location: true },
      });

      if (dto.status && dto.status !== device.status) {
        await tx.deviceStatusHistory.create({
          data: {
            deviceId: id,
            fromStatus: device.status,
            toStatus: dto.status,
            reason: dto.status_reason ?? null,
          },
        });

        // Mempensiunkan device berarti mencabut seluruh kredensialnya.
        // Data historisnya TIDAK disentuh sama sekali — alasannya di
        // JAWABAN.md bagian A.
        if (dto.status === DeviceStatus.DECOMMISSIONED) {
          await tx.deviceCredential.updateMany({
            where: { deviceId: id, status: CredentialStatus.ACTIVE },
            data: { status: CredentialStatus.REVOKED, revokedAt: new Date() },
          });
        }
      }

      return result;
    });

    return serializeDevice(updated);
  }

  /**
   * Soft delete.
   *
   * Barisnya tidak pernah benar-benar dihapus karena masih menjadi induk
   * jutaan pembacaan historis. Yang terjadi: device ditandai terhapus,
   * statusnya menjadi DECOMMISSIONED, dan kredensialnya dicabut sehingga
   * ingestion baru ditolak.
   */
  async softDelete(id: string) {
    const device = await this.prisma.device.findFirst({ where: { id, deletedAt: null } });
    if (!device) {
      throw ApiException.notFound('Device', id);
    }

    await this.prisma.$transaction([
      this.prisma.device.update({
        where: { id },
        data: { deletedAt: new Date(), status: DeviceStatus.DECOMMISSIONED },
      }),
      this.prisma.deviceCredential.updateMany({
        where: { deviceId: id, status: CredentialStatus.ACTIVE },
        data: { status: CredentialStatus.REVOKED, revokedAt: new Date() },
      }),
      this.prisma.deviceStatusHistory.create({
        data: {
          deviceId: id,
          fromStatus: device.status,
          toStatus: DeviceStatus.DECOMMISSIONED,
          reason: 'Device dihapus (soft delete)',
        },
      }),
    ]);

    return { id, deleted: true, historical_data_retained: true };
  }

  /**
   * Rotasi kredensial.
   *
   * Kredensial lama TIDAK langsung dicabut, melainkan diberi tenggat tujuh
   * hari. Tanpa masa tenggang, device yang kebetulan sedang offline saat
   * rotasi akan terkunci di luar sistem secara permanen — dan justru device
   * yang sering offline itulah yang paling sulit dijangkau teknisi.
   */
  async rotateCredentials(id: string) {
    const device = await this.prisma.device.findFirst({ where: { id, deletedAt: null } });
    if (!device) {
      throw ApiException.notFound('Device', id);
    }

    const pepper = this.config.get<string>('deviceKeyPepper') ?? '';
    const credential = generateCredential(pepper);
    const gracePeriodEnd = new Date(Date.now() + ROTATION_GRACE_DAYS * 86_400_000);

    await this.prisma.$transaction([
      this.prisma.deviceCredential.updateMany({
        where: { deviceId: id, status: CredentialStatus.ACTIVE, expiresAt: null },
        data: { expiresAt: gracePeriodEnd },
      }),
      this.prisma.deviceCredential.create({
        data: {
          deviceId: id,
          keyId: credential.keyId,
          secretHash: credential.secretHash,
          secretPrefix: credential.secretPrefix,
        },
      }),
    ]);

    return {
      key_id: credential.keyId,
      device_key: credential.token,
      previous_credentials_valid_until: gracePeriodEnd.toISOString(),
      warning:
        'Simpan device_key sekarang juga. Kredensial lama masih diterima sampai ' +
        `${gracePeriodEnd.toISOString()} agar device yang sedang offline tidak terkunci.`,
    };
  }

  /**
   * Kesehatan device (ketentuan A.4).
   *
   * Menjawab pertanyaan "device ini sudah berapa lama diam?" tanpa menyentuh
   * tabel time-series, karena `last_seen_at` sengaja didenormalisasi ke tabel
   * device justru untuk keperluan ini.
   */
  async health(id: string) {
    const device = await this.prisma.device.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        deviceCode: true,
        status: true,
        lastSeenAt: true,
        lastBatteryV: true,
        lastRssi: true,
        firmwareVersion: true,
      },
    });

    if (!device) {
      throw ApiException.notFound('Device', id);
    }

    const heartbeats = await this.prisma.deviceHeartbeat.findMany({
      where: { deviceId: id },
      orderBy: { deviceTime: 'desc' },
      take: 24,
      select: { deviceTime: true, batteryV: true, rssi: true, uptimeS: true, source: true },
    });

    const thresholdMinutes = this.config.get<number>('deviceOfflineThresholdMinutes') ?? 15;
    const silentMinutes =
      device.lastSeenAt === null
        ? null
        : Math.floor((Date.now() - device.lastSeenAt.getTime()) / 60_000);

    return {
      device_id: device.id,
      device_code: device.deviceCode,
      status: device.status,
      last_seen_at: device.lastSeenAt?.toISOString() ?? null,
      silent_minutes: silentMinutes,
      offline_threshold_minutes: thresholdMinutes,
      is_silent: silentMinutes !== null && silentMinutes >= thresholdMinutes,
      battery_v: device.lastBatteryV,
      rssi: device.lastRssi,
      firmware_version: device.firmwareVersion,
      recent_heartbeats: heartbeats.map((row) => ({
        device_time: row.deviceTime.toISOString(),
        battery_v: row.batteryV,
        rssi: row.rssi,
        // uptime_s kecil setelah masa senyap adalah bukti device baru restart
        // — pembeda antara "perangkat mati" dan "jaringan putus".
        uptime_s: row.uptimeS === null ? null : Number(row.uptimeS),
        source: row.source,
      })),
    };
  }

  /** Daftar device yang tidak mengirim apa pun lebih dari X menit. */
  async silentDevices(minutes: number) {
    const threshold = new Date(Date.now() - minutes * 60_000);

    const rows = await this.prisma.device.findMany({
      where: {
        deletedAt: null,
        status: { in: [DeviceStatus.ACTIVE, DeviceStatus.MAINTENANCE] },
        OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: threshold } }],
      },
      select: { id: true, deviceCode: true, name: true, lastSeenAt: true, status: true },
      orderBy: { lastSeenAt: 'asc' },
    });

    return rows.map((row) => ({
      id: row.id,
      device_code: row.deviceCode,
      name: row.name,
      status: row.status,
      last_seen_at: row.lastSeenAt?.toISOString() ?? null,
      silent_minutes:
        row.lastSeenAt === null
          ? null
          : Math.floor((Date.now() - row.lastSeenAt.getTime()) / 60_000),
    }));
  }

  private assertTransitionAllowed(from: DeviceStatus, to: DeviceStatus): void {
    if (!ALLOWED_TRANSITIONS[from].includes(to)) {
      throw new ApiException(
        ErrorCode.INVALID_STATUS_TRANSITION,
        `Status tidak boleh berpindah dari ${from} ke ${to}. ` +
          `Dari ${from}, tujuan yang diizinkan: ${ALLOWED_TRANSITIONS[from].join(', ') || 'tidak ada'}`,
        HttpStatus.CONFLICT,
      );
    }
  }
}

type DeviceWithLocation = Prisma.DeviceGetPayload<{ include: { location: true } }>;

function serializeDevice(device: DeviceWithLocation) {
  return {
    id: device.id,
    device_code: device.deviceCode,
    name: device.name,
    status: device.status,
    firmware_version: device.firmwareVersion,
    location: device.location
      ? {
          id: device.location.id,
          name: device.location.name,
          latitude: Number(device.location.latitude),
          longitude: Number(device.location.longitude),
          altitude_m: Number(device.location.altitudeM),
        }
      : null,
    installed_at: device.installedAt?.toISOString() ?? null,
    last_seen_at: device.lastSeenAt?.toISOString() ?? null,
    last_battery_v: device.lastBatteryV,
    last_rssi: device.lastRssi,
    created_at: device.createdAt.toISOString(),
    updated_at: device.updatedAt.toISOString(),
  };
}
