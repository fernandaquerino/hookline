import { type IncomingMessage, get } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type LiveEvent, liveChannel } from '@hookline/shared';
import { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, login, type TestApp } from './test-app';
import { resetDatabase } from './test-db';

let t: TestApp;
let cookie: string;
let baseUrl: string;

beforeAll(async () => {
  t = await createTestApp();
  await t.app.listen(0, '127.0.0.1');
  const { port } = t.app.getHttpServer().address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
  cookie = await login(t.app);
});

afterAll(async () => {
  await t.app.close();
});

beforeEach(async () => {
  await resetDatabase(t.prisma);
});

interface SseEvent {
  event: string;
  data: string;
}

/** Opens an SSE connection and collects parsed events. */
function openStream(path: string): Promise<{
  res: IncomingMessage;
  events: SseEvent[];
  next: (type: string) => Promise<SseEvent>;
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    const req = get(
      `${baseUrl}${path}`,
      { headers: { cookie, accept: 'text/event-stream' } },
      (res) => {
        const events: SseEvent[] = [];
        const waiters: Array<{ type: string; resolve: (e: SseEvent) => void }> = [];
        let buffer = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          buffer += chunk;
          let index: number;
          while ((index = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, index);
            buffer = buffer.slice(index + 2);
            const event = { event: 'message', data: '' };
            for (const line of block.split('\n')) {
              if (line.startsWith('event: ')) event.event = line.slice(7);
              if (line.startsWith('data: ')) event.data += line.slice(6);
            }
            if (!event.data) continue;
            events.push(event);
            const waiter = waiters.findIndex((w) => w.type === event.event);
            if (waiter !== -1) waiters.splice(waiter, 1)[0]?.resolve(event);
          }
        });
        const next = (type: string) =>
          new Promise<SseEvent>((done, fail) => {
            const found = events.find((e) => e.event === type);
            if (found) {
              events.splice(events.indexOf(found), 1);
              return done(found);
            }
            const timer = setTimeout(() => fail(new Error(`no ${type} event`)), 5_000);
            waiters.push({
              type,
              resolve: (e) => {
                clearTimeout(timer);
                events.splice(events.indexOf(e), 1);
                done(e);
              },
            });
          });
        resolve({ res, events, next, close: () => req.destroy() });
      },
    );
    req.on('error', reject);
  });
}

describe('GET /api/endpoints/:id/stream', () => {
  it('requires a session and an existing endpoint', async () => {
    const endpoint = await t.prisma.endpoint.create({ data: { name: 'x', slug: 'stream-auth' } });
    expect(
      (await request(t.app.getHttpServer()).get(`/api/endpoints/${endpoint.id}/stream`)).status,
    ).toBe(401);
    const missing = await request(t.app.getHttpServer())
      .get('/api/endpoints/00000000-0000-0000-0000-000000000000/stream')
      .set('Cookie', cookie);
    expect(missing.status).toBe(404);
  });

  it('streams new requests and delivery updates for the endpoint only', async () => {
    const endpoint = await t.prisma.endpoint.create({
      data: {
        name: 'Live',
        slug: 'stream-live',
        destinations: { create: { url: 'http://localhost:9/x' } },
      },
    });
    const other = await t.prisma.endpoint.create({ data: { name: 'Other', slug: 'stream-other' } });
    const stream = await openStream(`/api/endpoints/${endpoint.id}/stream`);
    try {
      expect(stream.res.statusCode).toBe(200);
      expect(stream.res.headers['content-type']).toMatch(/^text\/event-stream/);
      await stream.next('ready');

      await request(t.app.getHttpServer()).post(`/in/${other.slug}`).send('{}').expect(202);
      const ingest = await request(t.app.getHttpServer())
        .post(`/in/${endpoint.slug}`)
        .set('Content-Type', 'application/json')
        .send('{"live":true}')
        .expect(202);

      const received = JSON.parse((await stream.next('request.received')).data) as LiveEvent;
      expect(received).toMatchObject({
        type: 'request.received',
        endpointId: endpoint.id,
        request: {
          id: ingest.body.id,
          method: 'POST',
          sizeBytes: 13,
          deliveries: [{ status: 'PENDING' }],
        },
      });

      // The dispatcher publishes delivery updates on the same channel from another process.
      const publisher = new Redis(t.config.redisUrl);
      const update: LiveEvent = {
        type: 'delivery.updated',
        endpointId: endpoint.id,
        requestId: ingest.body.id,
        delivery: {
          id: '11111111-1111-1111-1111-111111111111',
          destinationId: '22222222-2222-2222-2222-222222222222',
          status: 'SUCCEEDED',
          attemptCount: 1,
          nextAttemptAt: null,
          replayOfId: null,
          createdAt: new Date().toISOString(),
        },
      };
      await publisher.publish(liveChannel(endpoint.id), JSON.stringify(update));
      publisher.disconnect();
      expect(JSON.parse((await stream.next('delivery.updated')).data)).toEqual(update);

      const types = stream.events.map((e) => e.event);
      expect(types).not.toContain('request.received');
    } finally {
      stream.close();
    }
  });
});

describe('shutdown with open streams', () => {
  it('ends live streams so the server can close', async () => {
    const app = await createTestApp();
    await app.app.listen(0, '127.0.0.1');
    const { port } = app.app.getHttpServer().address() as AddressInfo;
    const endpoint = await app.prisma.endpoint.create({ data: { name: 'x', slug: 'shutdown' } });
    const ended = new Promise<void>((resolve, reject) => {
      const req = get(
        `http://127.0.0.1:${port}/api/endpoints/${endpoint.id}/stream`,
        { headers: { cookie } },
        (res) => {
          res.resume();
          res.on('end', resolve);
          void app.app.close();
        },
      );
      req.on('error', reject);
    });
    await expect(
      Promise.race([ended, new Promise((_, r) => setTimeout(() => r(new Error('hung')), 5_000))]),
    ).resolves.toBeUndefined();
  });
});

describe('GET /health', () => {
  it('reports database, redis, outbox lag and queue depth', async () => {
    await t.prisma.outboxEvent.create({ data: { type: 'request.received', payload: {} } });
    const res = await request(t.app.getHttpServer()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      database: 'ok',
      redis: 'ok',
      outbox: { unpublished: 1, oldestAgeMs: expect.any(Number) },
      queue: { waiting: 0, delayed: 0, active: 0, failed: 0 },
    });
  });
});

describe('GET /health when Redis is down', () => {
  it('returns 503 and degraded', async () => {
    const broken = await createTestApp({ redisUrl: 'redis://127.0.0.1:1' });
    try {
      const res = await request(broken.app.getHttpServer()).get('/health');
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({
        status: 'degraded',
        database: 'ok',
        redis: 'error',
        queue: null,
      });
    } finally {
      await broken.app.close();
    }
  });
});

describe('ingest while Redis is down', () => {
  it('still stores the request and answers 202', async () => {
    const broken = await createTestApp({ redisUrl: 'redis://127.0.0.1:1' });
    try {
      const endpoint = await broken.prisma.endpoint.create({
        data: { name: 'x', slug: 'no-redis' },
      });
      const res = await request(broken.app.getHttpServer()).post(`/in/${endpoint.slug}`).send('{}');
      expect(res.status).toBe(202);
    } finally {
      await broken.app.close();
    }
  });
});
