import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { HealthController } from './health/health.controller';
import { IngestionModule } from './ingestion/ingestion.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      // Di dalam container, seluruh konfigurasi datang dari docker-compose
      // sehingga tidak ada berkas .env yang perlu dibaca. Daftar ini untuk
      // menjalankan API langsung di mesin pengembang: .env berada di root
      // monorepo, bukan di folder apps/api.
      envFilePath: ['../../.env', '.env'],
    }),
    PrismaModule,
    IngestionModule,
  ],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Dipasang untuk SEMUA route termasuk /healthz, supaya tidak ada request
    // yang masuk log tanpa request_id.
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
