import { Module } from '@nestjs/common';
import { DeviceAuthGuard } from '../auth/device-auth.guard';
import { DeviceRateLimitGuard } from './device-rate-limit.guard';
import { IngestionController } from './ingestion.controller';
import { IngestionService } from './ingestion.service';
import { ReferenceDataService } from './reference-data.service';

@Module({
  controllers: [IngestionController],
  providers: [IngestionService, ReferenceDataService, DeviceAuthGuard, DeviceRateLimitGuard],
  // ReferenceDataService diekspor karena modul sensor perlu membatalkan cache
  // tipe sensor ketika master data diubah lewat API.
  exports: [ReferenceDataService],
})
export class IngestionModule {}
