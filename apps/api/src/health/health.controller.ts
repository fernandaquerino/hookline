import { Controller, Get, Res } from '@nestjs/common';
import type { HealthDto } from '@hookline/shared';
import type { Response } from 'express';
import { Public } from '../auth/public.decorator';
import { HealthService } from './health.service';

/** `GET /health`: liveness plus outbox lag and queue depth. 503 when a dependency is down. */
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  async get(@Res({ passthrough: true }) res: Response): Promise<HealthDto> {
    const result = await this.health.check();
    res.status(result.status === 'ok' ? 200 : 503);
    return result;
  }
}
