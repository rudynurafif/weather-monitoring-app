import { Module } from '@nestjs/common';
import { LocationsModule } from '../locations/locations.module';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';

@Module({
  imports: [LocationsModule],
  controllers: [DevicesController],
  providers: [DevicesService],
})
export class DevicesModule {}
