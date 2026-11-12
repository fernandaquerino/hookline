import type { INestApplication } from '@nestjs/common';
import express from 'express';
import { ApiExceptionFilter } from './common/api-exception.filter';

/**
 * Shared HTTP setup for main.ts and tests. The global body parser is disabled so the ingest route
 * can read the raw bytes; only the management API parses JSON.
 */
export function configureApp(app: INestApplication): void {
  app.use('/api', express.json({ limit: '1mb' }));
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
}
