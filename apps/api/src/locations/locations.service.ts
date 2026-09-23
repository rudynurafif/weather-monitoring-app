import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ApiException } from '../common/errors/api.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateLocationDto, UpdateLocationDto } from './dto/location.dto';

type LocationRow = Prisma.LocationGetPayload<object>;

@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(page: number, perPage: number, q?: string) {
    const where = q ? { name: { contains: q, mode: Prisma.QueryMode.insensitive } } : {};

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.location.count({ where }),
      this.prisma.location.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * perPage,
        take: perPage,
        include: {
          // Jumlah device di tiap lokasi ikut dikirim supaya UI bisa menandai
          // lokasi yang sudah terpakai tanpa permintaan kedua.
          //
          // Yang dihitung hanya device yang masih hidup, karena itulah yang
          // dimaksud pengguna ketika membaca "3 device" di dropdown. Device
          // yang sudah di-soft-delete tetap menunjuk lokasi ini dan tetap
          // menghalangi penghapusannya — lihat remove() — tetapi memasukkannya
          // ke dalam angka ini hanya akan membuat daftarnya terbaca salah.
          _count: { select: { devices: { where: { deletedAt: null } } } },
        },
      }),
    ]);

    return {
      data: rows.map((row) => ({ ...serializeLocation(row), device_count: row._count.devices })),
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

  async findOne(id: string) {
    const location = await this.prisma.location.findUnique({
      where: { id },
      include: {
        devices: {
          where: { deletedAt: null },
          select: { id: true, deviceCode: true, name: true, status: true },
          orderBy: { deviceCode: 'asc' },
        },
      },
    });

    if (!location) {
      throw ApiException.notFound('Location', id);
    }

    return {
      ...serializeLocation(location),
      devices: location.devices.map((device) => ({
        id: device.id,
        device_code: device.deviceCode,
        name: device.name,
        status: device.status,
      })),
    };
  }

  async create(dto: CreateLocationDto) {
    const existing = await this.prisma.location.findUnique({ where: { name: dto.name } });
    if (existing) {
      throw ApiException.conflict(
        ErrorCode.ALREADY_EXISTS,
        `Lokasi dengan nama "${dto.name}" sudah terdaftar`,
      );
    }

    const created = await this.prisma.location.create({ data: toPrismaInput(dto) });
    return serializeLocation(created);
  }

  async update(id: string, dto: UpdateLocationDto) {
    const location = await this.prisma.location.findUnique({ where: { id } });
    if (!location) {
      throw ApiException.notFound('Location', id);
    }

    const updated = await this.prisma.location.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        // Decimal dibangun eksplisit agar nilai yang masuk tidak melewati
        // pembulatan floating point sebelum tersimpan.
        latitude: dto.latitude === undefined ? undefined : new Prisma.Decimal(dto.latitude),
        longitude: dto.longitude === undefined ? undefined : new Prisma.Decimal(dto.longitude),
        altitudeM: dto.altitude_m === undefined ? undefined : new Prisma.Decimal(dto.altitude_m),
      },
    });

    return serializeLocation(updated);
  }

  /**
   * Menghapus lokasi.
   *
   * Ditolak selama masih ada device yang menunjuknya. Lokasi bukan sekadar
   * label: ia yang memberi arti pada koordinat dan ketinggian seluruh data
   * historis device tersebut. Menghapusnya diam-diam akan membuat pembacaan
   * lama kehilangan konteks tempatnya diukur.
   */
  async remove(id: string) {
    // Device yang sudah di-soft-delete ikut dihitung dengan sengaja. Barisnya
    // memang tidak tampil lagi di daftar, tetapi pembacaan historisnya masih
    // ada dan masih bisa di-query — dan lokasi inilah yang memberi tahu di mana
    // pembacaan itu diambil. Menghapus lokasinya akan membuat data lama
    // kehilangan konteksnya secara permanen.
    const [activeCount, totalCount] = await this.prisma.$transaction([
      this.prisma.device.count({ where: { locationId: id, deletedAt: null } }),
      this.prisma.device.count({ where: { locationId: id } }),
    ]);

    if (totalCount > 0) {
      const retiredCount = totalCount - activeCount;
      const detail =
        activeCount > 0
          ? `masih dipakai ${activeCount} device aktif`
          : `masih ditunjuk ${retiredCount} device yang sudah dihapus, yang data historisnya tetap disimpan`;

      throw ApiException.conflict(
        ErrorCode.RESOURCE_IN_USE,
        `Lokasi ini ${detail}. ${
          activeCount > 0
            ? 'Pindahkan device-nya lebih dulu.'
            : 'Lokasi tidak bisa dihapus tanpa menghilangkan konteks tempat dari pembacaan lama.'
        }`,
      );
    }

    await this.prisma.location.delete({ where: { id } });
    return { id, deleted: true };
  }

  /**
   * Membuat lokasi di dalam transaksi milik pemanggil.
   *
   * Dipakai saat pendaftaran device sekaligus lokasinya (Bagian A.1), supaya
   * device dan lokasinya lahir atau gagal bersama — tidak mungkin ada lokasi
   * yatim yang terlanjur tersimpan ketika pembuatan device-nya gagal.
   */
  static async createWithin(
    tx: Prisma.TransactionClient,
    dto: CreateLocationDto,
  ): Promise<LocationRow> {
    const existing = await tx.location.findUnique({ where: { name: dto.name } });
    if (existing) {
      throw ApiException.conflict(
        ErrorCode.ALREADY_EXISTS,
        `Lokasi dengan nama "${dto.name}" sudah terdaftar. Pilih lokasi itu, atau pakai nama lain.`,
      );
    }

    return tx.location.create({ data: toPrismaInput(dto) });
  }
}

function toPrismaInput(dto: CreateLocationDto): Prisma.LocationCreateInput {
  return {
    name: dto.name,
    latitude: new Prisma.Decimal(dto.latitude),
    longitude: new Prisma.Decimal(dto.longitude),
    altitudeM: new Prisma.Decimal(dto.altitude_m),
    description: dto.description ?? null,
  };
}

export function serializeLocation(row: LocationRow) {
  return {
    id: row.id,
    name: row.name,
    // Decimal diubah ke number di batas API. Presisinya dijaga di database;
    // yang dikirim ke klien cukup angka biasa agar JSON-nya tidak berupa string.
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    altitude_m: Number(row.altitudeM),
    description: row.description,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}
