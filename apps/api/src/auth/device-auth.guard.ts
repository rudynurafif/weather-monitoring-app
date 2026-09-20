import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { DeviceStatus } from '@prisma/client';
import { ApiException } from '../common/errors/api.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { parseDeviceKey, verifySecret } from './device-key.util';

export const DEVICE_KEY_HEADER = 'x-device-key';

/** Device yang sudah terautentikasi, ditempelkan ke request. */
export interface AuthenticatedDevice {
  id: string;
  deviceCode: string;
  status: DeviceStatus;
  credentialId: string;
}

export interface RequestWithDevice extends Request {
  device?: AuthenticatedDevice;
  requestId?: string;
}

/**
 * Autentikasi device untuk seluruh endpoint ingestion.
 *
 * Dipasang paling depan — sebelum validasi payload dan sebelum menyentuh
 * apa pun yang mahal — supaya request tak sah tidak pernah menghabiskan CPU
 * untuk mem-parsing 500 record.
 *
 * Autentikasi device sengaja BERBEDA dari autentikasi user dashboard yang
 * memakai JWT. Alasannya diuraikan di JAWABAN.md bagian E; ringkasnya, device
 * adalah klien tanpa pengawasan manusia yang kredensialnya hidup bertahun-tahun
 * di dalam perangkat keras di lapangan, sementara sesi manusia berumur pendek
 * dan bisa dicabut kapan saja.
 */
@Injectable()
export class DeviceAuthGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithDevice>();
    const header = request.header(DEVICE_KEY_HEADER);

    if (!header) {
      throw new ApiException(
        ErrorCode.UNAUTHENTICATED,
        `Header ${DEVICE_KEY_HEADER} wajib diisi`,
        HttpStatus.UNAUTHORIZED,
      );
    }

    const parsed = parseDeviceKey(header);
    if (!parsed) {
      throw new ApiException(
        ErrorCode.INVALID_DEVICE_CREDENTIAL,
        `Format ${DEVICE_KEY_HEADER} harus "<key_id>.<secret>"`,
        HttpStatus.UNAUTHORIZED,
      );
    }

    const credential = await this.prisma.deviceCredential.findUnique({
      where: { keyId: parsed.keyId },
      select: {
        id: true,
        secretHash: true,
        status: true,
        expiresAt: true,
        device: { select: { id: true, deviceCode: true, status: true, deletedAt: true } },
      },
    });

    const pepper = this.config.get<string>('deviceKeyPepper') ?? '';

    // Kredensial tidak ditemukan dan secret salah dijawab dengan pesan yang
    // SAMA PERSIS. Membedakan keduanya akan mengubah endpoint ini menjadi alat
    // untuk memetakan key_id mana yang benar-benar ada.
    if (!credential || !verifySecret(parsed.secret, credential.secretHash, pepper)) {
      throw new ApiException(
        ErrorCode.INVALID_DEVICE_CREDENTIAL,
        'Kredensial device tidak valid',
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (credential.status === 'REVOKED') {
      throw new ApiException(
        ErrorCode.INVALID_DEVICE_CREDENTIAL,
        'Kredensial device sudah dicabut',
        HttpStatus.UNAUTHORIZED,
      );
    }

    // Kredensial lama yang sedang dalam masa tenggang rotasi tetap diterima
    // sampai expires_at terlampaui.
    if (credential.expiresAt && credential.expiresAt.getTime() <= Date.now()) {
      throw new ApiException(
        ErrorCode.INVALID_DEVICE_CREDENTIAL,
        'Kredensial device sudah kedaluwarsa, gunakan kredensial hasil rotasi',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const device = credential.device;

    if (device.deletedAt !== null) {
      throw new ApiException(
        ErrorCode.DEVICE_NOT_REGISTERED,
        'Device sudah dihapus',
        HttpStatus.NOT_FOUND,
      );
    }

    if (device.status === DeviceStatus.DECOMMISSIONED) {
      throw new ApiException(
        ErrorCode.DEVICE_NOT_ACTIVE,
        'Device sudah dipensiunkan dan tidak menerima data baru',
        HttpStatus.FORBIDDEN,
      );
    }

    request.device = {
      id: device.id,
      deviceCode: device.deviceCode,
      status: device.status,
      credentialId: credential.id,
    };

    // Pencatatan pemakaian terakhir sengaja tidak di-await: nilainya untuk
    // audit, dan tidak sepadan bila membuat ingestion menunggu satu perjalanan
    // tambahan ke database. Kegagalannya pun tidak boleh menggagalkan request.
    void this.prisma.deviceCredential
      .update({ where: { id: credential.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);

    return true;
  }
}
