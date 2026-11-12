import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { DispatcherConfig } from '../src/config/dispatcher-config';
import { DispatcherModule, type DispatcherModuleOptions } from '../src/dispatcher.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertTestDatabase } from './test-db';

export function testDispatcherConfig(overrides: Partial<DispatcherConfig> = {}): DispatcherConfig {
  const databaseUrl = process.env.DATABASE_URL ?? '';
  assertTestDatabase(databaseUrl);
  return {
    nodeEnv: 'test',
    databaseUrl,
    redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
    // A fresh prefix per context keeps queues of different tests apart.
    queuePrefix: `hookline-test-${randomUUID()}`,
    allowPrivateDestinations: true,
    retryBaseMs: 20,
    retryCapMs: 200,
    retentionDays: 7,
    outboxPollMs: 25,
    outboxBatchSize: 100,
    workerConcurrency: 4,
    staleInFlightMs: 60_000,
    ...overrides,
  };
}

export interface TestDispatcher {
  app: INestApplicationContext;
  prisma: PrismaService;
  config: DispatcherConfig;
}

export async function createTestDispatcher(
  options: Omit<DispatcherModuleOptions, 'config'> & { config?: Partial<DispatcherConfig> } = {},
  configure?: (builder: ReturnType<typeof Test.createTestingModule>) => void,
): Promise<TestDispatcher> {
  const config = testDispatcherConfig(options.config);
  const builder = Test.createTestingModule({
    imports: [DispatcherModule.forRoot({ ...options, config })],
  });
  configure?.(builder);
  const moduleRef = await builder.compile();
  moduleRef.useLogger(false);
  const app = await moduleRef.init();
  return { app, prisma: app.get(PrismaService), config };
}
