import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Global agar tidak perlu di-import berulang di setiap feature module.
 * Satu instance PrismaClient dipakai seluruh aplikasi — membuat client baru per
 * modul berarti membuat connection pool baru per modul.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
