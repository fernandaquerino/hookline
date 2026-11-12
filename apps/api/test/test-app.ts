import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { type AppConfig, MAX_BODY_BYTES } from '../src/config/app-config';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertTestDatabase } from './test-db';

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const databaseUrl = process.env.DATABASE_URL ?? '';
  assertTestDatabase(databaseUrl);
  return {
    nodeEnv: 'test',
    port: 0,
    databaseUrl,
    redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
    encryptionKey: randomBytes(32),
    adminPasswordHash: null,
    sessionSecret: 'test-session-secret-0123456789',
    publicIngestBaseUrl: 'http://localhost:4000',
    redactHeaders: ['x-api-key'],
    allowPrivateDestinations: true,
    maxBodyBytes: MAX_BODY_BYTES,
    ...overrides,
  };
}

export interface TestApp {
  app: INestApplication;
  prisma: PrismaService;
  config: AppConfig;
}

export async function createTestApp(overrides: Partial<AppConfig> = {}): Promise<TestApp> {
  const config = testConfig(overrides);
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(config)],
  }).compile();
  const app = moduleRef.createNestApplication({ bodyParser: false, logger: false });
  configureApp(app);
  await app.init();
  return { app, prisma: app.get(PrismaService), config };
}
