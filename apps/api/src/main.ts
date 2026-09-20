import 'reflect-metadata';
import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

async function bootstrap(): Promise<void> {
  // Proses backend selalu berjalan dalam UTC. Konsekuensinya: new Date(),
  // now() pada query, dan semua log memakai UTC tanpa bergantung pada
  // timezone mesin. Konversi ke WIB HANYA terjadi di lapisan presentasi.
  process.env.TZ = 'UTC';

  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  app.setGlobalPrefix('api/v1', {
    // Endpoint operasional berada di luar versi API.
    exclude: ['healthz', 'metrics'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,            // buang field yang tidak dikenal
      forbidNonWhitelisted: false, // device boleh menambah field baru tanpa memecah ingestion
      transform: true,             // ubah payload mentah jadi instance DTO
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());

  app.enableCors({
    origin: true,
    exposedHeaders: ['x-request-id'],
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Weather Station Monitoring API')
    .setDescription(
      'API ingestion & query untuk platform monitoring stasiun cuaca. ' +
        'Semua timestamp dalam UTC (ISO 8601, suffix Z).',
    )
    .setVersion('1.0')
    .addApiKey(
      { type: 'apiKey', name: 'X-Device-Key', in: 'header' },
      'device-key',
    )
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'user-jwt')
    .build();

  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swaggerConfig), {
    swaggerOptions: { persistAuthorization: true },
  });

  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port, '0.0.0.0');

  new Logger('Bootstrap').log(`API siap di http://localhost:${port} (docs: /docs)`);
}

void bootstrap();
