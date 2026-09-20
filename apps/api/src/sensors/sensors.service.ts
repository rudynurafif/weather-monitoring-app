import { HttpStatus, Injectable } from '@nestjs/common';
import { SensorStatus } from '@prisma/client';
import { ApiException } from '../common/errors/api.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { ReferenceDataService } from '../ingestion/reference-data.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateCalibrationDto,
  CreateSensorDto,
  CreateSensorTypeDto,
  InstallSensorDto,
  UninstallSensorDto,
  UpdateSensorDto,
} from './dto/sensor.dto';

@Injectable()
export class SensorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reference: ReferenceDataService,
  ) {}

  // -------------------------------------------------------------------
  // Tipe sensor (master data)
  // -------------------------------------------------------------------

  async listSensorTypes() {
    const rows = await this.prisma.sensorType.findMany({ orderBy: { key: 'asc' } });
    return rows.map(serializeSensorType);
  }

  async createSensorType(dto: CreateSensorTypeDto) {
    if (dto.min_valid >= dto.max_valid) {
      throw ApiException.validation('min_valid harus lebih kecil daripada max_valid', [
        { field: 'min_valid', code: 'INVALID_RANGE', message: 'Harus lebih kecil dari max_valid' },
      ]);
    }

    if (dto.is_cumulative && (dto.unit_per_count === undefined || dto.unit_per_count <= 0)) {
      // Tanpa faktor konversi, pencacah kumulatif tidak bisa diubah menjadi
      // besaran fisik apa pun — deltanya akan selalu 0 atau salah satuan.
      throw ApiException.validation(
        'Tipe sensor kumulatif wajib punya unit_per_count yang positif',
        [
          {
            field: 'unit_per_count',
            code: 'REQUIRED_FOR_CUMULATIVE',
            message: 'Contoh: rain_counter memakai 0.2 mm per jungkitan',
          },
        ],
      );
    }

    const existing = await this.prisma.sensorType.findUnique({ where: { key: dto.key } });
    if (existing) {
      throw ApiException.conflict(
        ErrorCode.ALREADY_EXISTS,
        `Tipe sensor "${dto.key}" sudah terdaftar`,
      );
    }

    const created = await this.prisma.sensorType.create({
      data: {
        key: dto.key,
        displayName: dto.display_name,
        unit: dto.unit,
        minValid: dto.min_valid,
        maxValid: dto.max_valid,
        precision: dto.precision,
        isCumulative: dto.is_cumulative,
        unitPerCount: dto.unit_per_count ?? null,
        isCircular: dto.is_circular,
      },
    });

    // Jalur ingestion menyimpan tipe sensor di cache 60 detik. Tanpa
    // pembatalan ini, sensor yang baru didaftarkan akan ditolak sebagai
    // UNKNOWN_SENSOR_TYPE sampai cache-nya kedaluwarsa sendiri.
    this.reference.invalidateSensorTypeCache();

    return serializeSensorType(created);
  }

  // -------------------------------------------------------------------
  // Sensor fisik
  // -------------------------------------------------------------------

  async listSensors(page: number, perPage: number, sensorTypeKey?: string) {
    const where = {
      deletedAt: null,
      ...(sensorTypeKey ? { sensorType: { key: sensorTypeKey } } : {}),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.sensor.count({ where }),
      this.prisma.sensor.findMany({
        where,
        include: {
          sensorType: true,
          installations: {
            where: { removedAt: null },
            include: { device: { select: { id: true, deviceCode: true, name: true } } },
            take: 1,
          },
        },
        orderBy: { serialNumber: 'asc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
    ]);

    return {
      data: rows.map((row) => ({
        id: row.id,
        serial_number: row.serialNumber,
        sensor_type: row.sensorType.key,
        unit: row.sensorType.unit,
        manufacturer: row.manufacturer,
        model: row.model,
        status: row.status,
        // Pemasangan yang sedang aktif, kalau ada. Sensor di gudang tidak
        // terpasang di mana pun dan nilainya null.
        installed_on: row.installations[0]
          ? {
              device_id: row.installations[0].device.id,
              device_code: row.installations[0].device.deviceCode,
              channel: row.installations[0].channel,
              installed_at: row.installations[0].installedAt.toISOString(),
            }
          : null,
      })),
      meta: {
        pagination: {
          page,
          per_page: perPage,
          total,
          total_pages: Math.ceil(total / perPage) || 1,
        },
      },
    };
  }

  async createSensor(dto: CreateSensorDto) {
    const sensorType = await this.prisma.sensorType.findUnique({
      where: { key: dto.sensor_type },
    });

    if (!sensorType) {
      throw new ApiException(
        ErrorCode.UNKNOWN_SENSOR_TYPE,
        `Tipe sensor "${dto.sensor_type}" tidak terdaftar`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const existing = await this.prisma.sensor.findUnique({
      where: { serialNumber: dto.serial_number },
    });

    if (existing) {
      throw ApiException.conflict(
        ErrorCode.ALREADY_EXISTS,
        `Sensor dengan nomor seri "${dto.serial_number}" sudah terdaftar`,
      );
    }

    const created = await this.prisma.sensor.create({
      data: {
        serialNumber: dto.serial_number,
        sensorTypeId: sensorType.id,
        manufacturer: dto.manufacturer ?? null,
        model: dto.model ?? null,
        status: SensorStatus.IN_STOCK,
      },
      include: { sensorType: true },
    });

    return {
      id: created.id,
      serial_number: created.serialNumber,
      sensor_type: created.sensorType.key,
      status: created.status,
    };
  }

  async updateSensor(id: string, dto: UpdateSensorDto) {
    const sensor = await this.prisma.sensor.findFirst({ where: { id, deletedAt: null } });
    if (!sensor) {
      throw ApiException.notFound('Sensor', id);
    }

    const updated = await this.prisma.sensor.update({
      where: { id },
      data: { status: dto.status, manufacturer: dto.manufacturer, model: dto.model },
      include: { sensorType: true },
    });

    return {
      id: updated.id,
      serial_number: updated.serialNumber,
      sensor_type: updated.sensorType.key,
      status: updated.status,
    };
  }

  /**
   * Soft delete sensor.
   *
   * Ditolak bila sensornya masih terpasang: melepas sensor adalah peristiwa
   * lapangan yang harus tercatat waktunya, bukan efek samping diam-diam dari
   * penghapusan baris di sistem.
   */
  async deleteSensor(id: string) {
    const active = await this.prisma.sensorInstallation.findFirst({
      where: { sensorId: id, removedAt: null },
    });

    if (active) {
      throw ApiException.conflict(
        ErrorCode.SENSOR_ALREADY_INSTALLED,
        'Sensor masih terpasang. Lepas dulu dari device-nya sebelum dihapus.',
      );
    }

    await this.prisma.sensor.update({
      where: { id },
      data: { deletedAt: new Date(), status: SensorStatus.RETIRED },
    });

    return { id, deleted: true };
  }

  // -------------------------------------------------------------------
  // Pemasangan
  // -------------------------------------------------------------------

  /**
   * Memasang sensor ke device.
   *
   * Tidak ada baris lama yang diubah: pemasangan baru selalu berupa baris
   * baru. Itulah yang membuat data historis tetap terikat pada device tempat
   * sensor itu berada saat pengukurannya terjadi.
   *
   * Dua exclusion constraint di database menjadi jaring pengaman terakhir —
   * satu sensor tidak bisa terpasang di dua tempat sekaligus, dan satu slot
   * tidak bisa diisi dua sensor sekaligus. Pemeriksaan di sini ada supaya
   * pesan errornya ramah, bukan supaya aturannya ditegakkan di sini.
   */
  async installSensor(deviceId: string, dto: InstallSensorDto) {
    const [device, sensor] = await Promise.all([
      this.prisma.device.findFirst({ where: { id: deviceId, deletedAt: null } }),
      this.prisma.sensor.findFirst({
        where: { id: dto.sensor_id, deletedAt: null },
        include: { sensorType: true },
      }),
    ]);

    if (!device) {
      throw ApiException.notFound('Device', deviceId);
    }
    if (!sensor) {
      throw ApiException.notFound('Sensor', dto.sensor_id);
    }

    const installedAt = dto.installed_at ? new Date(dto.installed_at) : new Date();

    const stillInstalled = await this.prisma.sensorInstallation.findFirst({
      where: { sensorId: sensor.id, removedAt: null },
      include: { device: { select: { deviceCode: true } } },
    });

    if (stillInstalled) {
      throw ApiException.conflict(
        ErrorCode.SENSOR_ALREADY_INSTALLED,
        `Sensor ini masih terpasang di device ${stillInstalled.device.deviceCode}. ` +
          'Lepas dulu dari sana sebelum memasangnya di tempat lain.',
      );
    }

    const slotTaken = await this.prisma.sensorInstallation.findFirst({
      where: {
        deviceId,
        sensorTypeId: sensor.sensorTypeId,
        channel: dto.channel,
        removedAt: null,
      },
    });

    if (slotTaken) {
      throw ApiException.conflict(
        ErrorCode.SENSOR_ALREADY_INSTALLED,
        `Slot ${sensor.sensorType.key} channel ${dto.channel} pada device ini sudah terisi. ` +
          'Pakai channel lain, atau lepas sensor yang sekarang menempatinya.',
      );
    }

    const installation = await this.prisma.$transaction(async (tx) => {
      const created = await tx.sensorInstallation.create({
        data: {
          sensorId: sensor.id,
          deviceId,
          // Disalin dari sensor, bukan diminta dari klien, supaya tidak
          // mungkin ada baris yang tipenya berbeda dengan sensornya.
          sensorTypeId: sensor.sensorTypeId,
          channel: dto.channel,
          installedAt,
          notes: dto.notes ?? null,
        },
      });

      await tx.sensor.update({
        where: { id: sensor.id },
        data: { status: SensorStatus.INSTALLED },
      });

      return created;
    });

    return {
      installation_id: installation.id,
      device_id: deviceId,
      sensor_id: sensor.id,
      sensor_type: sensor.sensorType.key,
      channel: installation.channel,
      installed_at: installation.installedAt.toISOString(),
    };
  }

  /** Melepas sensor: baris pemasangan DITUTUP, bukan dihapus. */
  async uninstallSensor(deviceId: string, sensorId: string, dto: UninstallSensorDto) {
    const installation = await this.prisma.sensorInstallation.findFirst({
      where: { deviceId, sensorId, removedAt: null },
    });

    if (!installation) {
      throw new ApiException(
        ErrorCode.SENSOR_NOT_INSTALLED,
        'Sensor ini tidak sedang terpasang di device tersebut',
        HttpStatus.NOT_FOUND,
      );
    }

    const removedAt = dto.removed_at ? new Date(dto.removed_at) : new Date();

    if (removedAt <= installation.installedAt) {
      throw ApiException.validation('removed_at harus setelah installed_at', [
        {
          field: 'removed_at',
          code: 'INVALID_RANGE',
          message: `Pemasangan dimulai ${installation.installedAt.toISOString()}`,
        },
      ]);
    }

    await this.prisma.$transaction([
      this.prisma.sensorInstallation.update({
        where: { id: installation.id },
        data: {
          removedAt,
          notes: dto.notes ?? installation.notes,
        },
      }),
      this.prisma.sensor.update({
        where: { id: sensorId },
        data: { status: SensorStatus.IN_STOCK },
      }),
    ]);

    return {
      installation_id: installation.id,
      removed_at: removedAt.toISOString(),
      historical_data_retained: true,
    };
  }

  // -------------------------------------------------------------------
  // Kalibrasi
  // -------------------------------------------------------------------

  async listCalibrations(sensorId: string) {
    const rows = await this.prisma.sensorCalibration.findMany({
      where: { sensorId },
      orderBy: { effectiveFrom: 'desc' },
    });

    return rows.map((row) => ({
      id: row.id,
      offset: row.offset,
      scale: row.scale,
      effective_from: row.effectiveFrom.toISOString(),
      effective_to: row.effectiveTo?.toISOString() ?? null,
      is_current: row.effectiveTo === null,
      notes: row.notes,
      created_at: row.createdAt.toISOString(),
    }));
  }

  /**
   * Menambah kalibrasi baru.
   *
   * Yang terjadi: kalibrasi yang sedang berlaku DITUTUP pada waktu mulai yang
   * baru, lalu baris baru dibuka. Data lama tidak disentuh sama sekali —
   * pembacaan yang sudah tersimpan tetap memakai koreksi yang memang berlaku
   * saat pengukurannya terjadi. Konsekuensi lengkapnya ada di JAWABAN.md
   * bagian B.
   */
  async createCalibration(sensorId: string, dto: CreateCalibrationDto) {
    const sensor = await this.prisma.sensor.findFirst({ where: { id: sensorId, deletedAt: null } });
    if (!sensor) {
      throw ApiException.notFound('Sensor', sensorId);
    }

    if (dto.scale === 0) {
      // scale 0 akan membuat setiap pembacaan menjadi konstanta offset —
      // seluruh data sensor ini kehilangan makna tanpa satu pun error muncul.
      throw ApiException.validation('scale tidak boleh 0', [
        {
          field: 'scale',
          code: 'INVALID_VALUE',
          message: 'scale 0 akan membuat semua pembacaan bernilai sama dengan offset',
        },
      ]);
    }

    const effectiveFrom = dto.effective_from ? new Date(dto.effective_from) : new Date();

    const created = await this.prisma.$transaction(async (tx) => {
      // Tutup kalibrasi yang masih terbuka dan bersinggungan dengan waktu
      // mulai yang baru. Tanpa ini, exclusion constraint di database akan
      // menolak penyisipannya.
      await tx.sensorCalibration.updateMany({
        where: { sensorId, effectiveTo: null, effectiveFrom: { lt: effectiveFrom } },
        data: { effectiveTo: effectiveFrom },
      });

      return tx.sensorCalibration.create({
        data: {
          sensorId,
          offset: dto.offset,
          scale: dto.scale,
          effectiveFrom,
          effectiveTo: null,
          notes: dto.notes ?? null,
        },
      });
    });

    return {
      id: created.id,
      sensor_id: sensorId,
      offset: created.offset,
      scale: created.scale,
      effective_from: created.effectiveFrom.toISOString(),
      effective_to: null,
      applies_to:
        'Hanya pembacaan dengan device_time mulai dari effective_from. Data lama TIDAK ' +
        'dihitung ulang; nilai mentahnya tetap tersimpan sehingga perhitungan ulang ' +
        'masih mungkin dilakukan kapan saja.',
    };
  }
}

function serializeSensorType(row: {
  id: number;
  key: string;
  displayName: string;
  unit: string;
  minValid: number;
  maxValid: number;
  precision: number;
  isCumulative: boolean;
  unitPerCount: number | null;
  isCircular: boolean;
}) {
  return {
    id: row.id,
    key: row.key,
    display_name: row.displayName,
    unit: row.unit,
    min_valid: row.minValid,
    max_valid: row.maxValid,
    precision: row.precision,
    is_cumulative: row.isCumulative,
    unit_per_count: row.unitPerCount,
    is_circular: row.isCircular,
  };
}
