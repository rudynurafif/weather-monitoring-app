import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CreateLocationDto, ListLocationsDto, UpdateLocationDto } from './dto/location.dto';
import { LocationsService } from './locations.service';

@ApiTags('locations')
@Controller('locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get()
  @ApiOperation({
    summary: 'Daftar lokasi',
    description:
      'Menyertakan jumlah device di tiap lokasi, supaya UI bisa menandai lokasi yang ' +
      'sudah terpakai tanpa permintaan kedua.',
  })
  list(@Query() query: ListLocationsDto) {
    return this.locations.list(query.page, query.per_page, query.q);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detail lokasi beserta device yang terpasang di sana' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.locations.findOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Mendaftarkan lokasi baru',
    description:
      'Lokasi juga bisa dibuat sekaligus saat mendaftarkan device lewat POST /devices ' +
      'dengan field location.',
  })
  @ApiResponse({ status: 409, description: 'Nama lokasi sudah terdaftar' })
  create(@Body() dto: CreateLocationDto) {
    return this.locations.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Memperbarui lokasi' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLocationDto) {
    return this.locations.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Menghapus lokasi',
    description: 'Ditolak selama masih ada device yang menunjuk lokasi ini.',
  })
  @ApiResponse({ status: 409, description: 'Lokasi masih dipakai device' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.locations.remove(id);
  }
}
