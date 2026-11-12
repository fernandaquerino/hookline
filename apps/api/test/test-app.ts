import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { hashPassword } from '../src/auth/password';
import { type AppConfig, MAX_BODY_BYTES } from '../src/config/app-config';
import { PrismaService } from '../src/prisma/prisma.service';
import type { Resolver } from '@hookline/ssrf';
import { assertTestDatabase } from './test-db';

/** The admin password used by tests; its hash is computed once per test file. */
export const TEST_PASSWORD = 'correct horse battery staple';
export let TEST_PASSWORD_HASH = '';

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const databaseUrl = process.env.DATABASE_URL ?? '';
  assertTestDatabase(databaseUrl);
  return {
    nodeEnv: 'test',
    port: 0,
    databaseUrl,
    redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
    encryptionKey: randomBytes(32),
    adminPasswordHash: TEST_PASSWORD_HASH,
    queuePrefix: `hookline-test-${randomBytes(6).toString('hex')}`,
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

export async function createTestApp(
  overrides: Partial<AppConfig> = {},
  resolver?: Resolver,
): Promise<TestApp> {
  if (!TEST_PASSWORD_HASH) TEST_PASSWORD_HASH = await hashPassword(TEST_PASSWORD);
  const config = testConfig(overrides);
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot({ config, resolver })],
  }).compile();
  const app = moduleRef.createNestApplication({ bodyParser: false, logger: false });
  configureApp(app);
  await app.init();
  return { app, prisma: app.get(PrismaService), config };
}

/** Signs in and returns the session cookie header value. */
export async function login(app: INestApplication): Promise<string> {
  const { default: request } = await import('supertest');
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ password: TEST_PASSWORD })
    .expect(204);
  const cookie = res.headers['set-cookie']?.[0];
  if (!cookie) throw new Error('login did not set a cookie');
  return cookie.split(';')[0] ?? '';
}
