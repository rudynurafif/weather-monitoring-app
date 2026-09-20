import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

/**
 * Endpoint operasional. Sengaja TIDAK berada di bawah prefix /api/v1 dan tidak
 * memakai envelope response, karena yang mengonsumsinya adalah docker
 * healthcheck / orchestrator, bukan klien API.
 */
@ApiTags('ops')
@Controller()
export class HealthController {
  private readonly startedAt = Date.now();

  @Get('healthz')
  @ApiOperation({ summary: 'Liveness probe — proses hidup dan bisa melayani request' })
  liveness(): Record<string, unknown> {
    return {
      status: 'ok',
      uptime_s: Math.floor((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
    };
  }
}
