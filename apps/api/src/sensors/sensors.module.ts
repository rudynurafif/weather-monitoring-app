import { Module } from '@nestjs/common';
import { IngestionModule } from '../ingestion/ingestion.module';
import { SensorsController } from './sensors.controller';
import { SensorsService } from './sensors.service';

@Module({
  // IngestionModule di-import demi ReferenceDataService: mendaftarkan tipe
  // sensor baru harus membatalkan cache-nya, kalau tidak sensor yang baru
  // dibuat akan ditolak sebagai UNKNOWN_SENSOR_TYPE selama satu menit.
  imports: [IngestionModule],
  controllers: [SensorsController],
  providers: [SensorsService],
})
export class SensorsModule {}
