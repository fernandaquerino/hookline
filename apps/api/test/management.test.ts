import type { LookupAddress } from 'node:dns';
import { decryptSecret } from '@hookline/db';
import { OutboxEventType } from '@hookline/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, login, type TestApp } from './test-app';
import { resetDatabase } from './test-db';

let t: TestApp;
let cookie: string;

/** Fake DNS for the save-time SSRF check. */
async function resolver(hostname: string): Promise<LookupAddress[]> {
  if (hostname === 'hooks.example.com') return [{ address: '93.184.216.34', family: 4 }];
  if (hostname === 'internal.example.com') return [{ address: '10.1.2.3', family: 4 }];
  throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' });
}

beforeAll(async () => {
  t = await createTestApp({ allowPrivateDestinations: false }, resolver);
  cookie = await login(t.app);
});

afterAll(async () => {
  await t.app.close();
});

beforeEach(async () => {
  await resetDatabase(t.prisma);
});

const api = () => {
  const agent = request(t.app.getHttpServer());
  return {
    get: (path: string) => agent.get(path).set('Cookie', cookie),
    post: (path: string, body?: object) => agent.post(path).set('Cookie', cookie).send(body),
    patch: (path: string, body: object) => agent.patch(path).set('Cookie', cookie).send(body),
    delete: (path: string) => agent.delete(path).set('Cookie', cookie),
  };
};

async function createEndpoint(body: object = { name: 'Orders' }) {
  const res = await api().post('/api/endpoints', body);
  expect(res.status).toBe(201);
  return res.body;
}

describe('endpoints', () => {
  it('creates an endpoint with a random slug and ingest URL', async () => {
    const endpoint = await createEndpoint({ name: 'Orders' });
    expect(endpoint).toMatchObject({
      name: 'Orders',
      signingScheme: 'none',
      hasSigningSecret: false,
      dedupeHeader: null,
      lastRequestAt: null,
      destinations: [],
    });
    expect(endpoint.slug).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(endpoint.ingestUrl).toBe(`http://localhost:4000/in/${endpoint.slug}`);
    const other = await createEndpoint({ name: 'Other' });
    expect(other.slug).not.toBe(endpoint.slug);
  });

  it('encrypts the signing secret and never returns it', async () => {
    const endpoint = await createEndpoint({
      name: 'GitHub',
      signingScheme: 'github',
      signingSecret: 'my-webhook-secret',
      dedupeHeader: 'X-GitHub-Delivery',
    });
    expect(endpoint).toMatchObject({ hasSigningSecret: true, dedupeHeader: 'x-github-delivery' });
    expect(JSON.stringify(endpoint)).not.toContain('my-webhook-secret');
    const row = await t.prisma.endpoint.findUniqueOrThrow({ where: { id: endpoint.id } });
    expect(row.signingSecretEnc).not.toContain('my-webhook-secret');
    expect(decryptSecret(row.signingSecretEnc ?? '', t.config.encryptionKey)).toBe(
      'my-webhook-secret',
    );
  });

  it('validates input', async () => {
    const cases = [
      {},
      { name: '' },
      { name: 'x', signingScheme: 'github' },
      { name: 'x', signingScheme: 'nope' },
      { name: 'x', dedupeHeader: 'bad header' },
      { name: 'x', unknown: true },
    ];
    for (const body of cases) {
      const res = await api().post('/api/endpoints', body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    }
  });

  it('lists, gets, updates and deletes', async () => {
    const endpoint = await createEndpoint();
    expect((await api().get('/api/endpoints')).body).toHaveLength(1);
    expect((await api().get(`/api/endpoints/${endpoint.id}`)).body.id).toBe(endpoint.id);

    const updated = await api().patch(`/api/endpoints/${endpoint.id}`, {
      name: 'Renamed',
      signingScheme: 'stripe',
      signingSecret: 'whsec_x',
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({
      name: 'Renamed',
      signingScheme: 'stripe',
      hasSigningSecret: true,
    });

    const cleared = await api().patch(`/api/endpoints/${endpoint.id}`, { signingScheme: 'none' });
    expect(cleared.body).toMatchObject({ signingScheme: 'none', hasSigningSecret: false });

    const noSecret = await api().patch(`/api/endpoints/${endpoint.id}`, {
      signingScheme: 'github',
    });
    expect(noSecret.status).toBe(400);

    expect((await api().delete(`/api/endpoints/${endpoint.id}`)).status).toBe(204);
    const missing = await api().get(`/api/endpoints/${endpoint.id}`);
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe('ENDPOINT_NOT_FOUND');
    expect((await api().get('/api/endpoints/not-a-uuid')).status).toBe(400);
  });

  it('reports the last request time', async () => {
    const endpoint = await createEndpoint();
    await request(t.app.getHttpServer()).post(`/in/${endpoint.slug}`).send('{}').expect(202);
    const res = await api().get('/api/endpoints');
    expect(res.body[0].lastRequestAt).not.toBeNull();
  });
});

describe('destinations', () => {
  it('creates, updates and deletes a destination with defaults', async () => {
    const endpoint = await createEndpoint();
    const created = await api().post(`/api/endpoints/${endpoint.id}/destinations`, {
      url: 'https://hooks.example.com/webhooks',
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ enabled: true, timeoutMs: 10_000, maxAttempts: 8 });

    const path = `/api/endpoints/${endpoint.id}/destinations/${created.body.id}`;
    const updated = await api().patch(path, { enabled: false, maxAttempts: 3 });
    expect(updated.body).toMatchObject({ enabled: false, maxAttempts: 3 });
    expect((await api().delete(path)).status).toBe(204);
    expect((await api().delete(path)).body.code).toBe('DESTINATION_NOT_FOUND');
  });

  it.each([
    'http://127.0.0.1:3000/hook',
    'http://localhost:3000/hook',
    'http://[::1]/hook',
    'http://169.254.169.254/latest/meta-data',
    'https://internal.example.com/hook',
    'https://does-not-resolve.example.com/hook',
  ])('rejects %s with DESTINATION_NOT_ALLOWED', async (url) => {
    const endpoint = await createEndpoint();
    const res = await api().post(`/api/endpoints/${endpoint.id}/destinations`, { url });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('DESTINATION_NOT_ALLOWED');
  });

  it('applies the SSRF check on update too', async () => {
    const endpoint = await createEndpoint();
    const created = await api().post(`/api/endpoints/${endpoint.id}/destinations`, {
      url: 'https://hooks.example.com/a',
    });
    const res = await api().patch(`/api/endpoints/${endpoint.id}/destinations/${created.body.id}`, {
      url: 'http://10.0.0.1/',
    });
    expect(res.body.code).toBe('DESTINATION_NOT_ALLOWED');
  });

  it('validates limits and protocol', async () => {
    const endpoint = await createEndpoint();
    for (const body of [
      { url: 'not a url' },
      { url: 'https://hooks.example.com', timeoutMs: 10 },
      { url: 'https://hooks.example.com', maxAttempts: 0 },
    ]) {
      expect((await api().post(`/api/endpoints/${endpoint.id}/destinations`, body)).status).toBe(
        400,
      );
    }
    const ftp = await api().post(`/api/endpoints/${endpoint.id}/destinations`, {
      url: 'ftp://hooks.example.com',
    });
    expect(ftp.body.code).toBe('DESTINATION_NOT_ALLOWED');
  });
});

describe('requests', () => {
  async function ingest(slug: string, count: number, headers: Record<string, string> = {}) {
    for (let i = 0; i < count; i++) {
      await request(t.app.getHttpServer())
        .post(`/in/${slug}?n=${i}`)
        .set({ 'Content-Type': 'application/json', ...headers })
        .send(JSON.stringify({ n: i }))
        .expect(202);
    }
  }

  it('paginates newest first with a cursor', async () => {
    const endpoint = await createEndpoint();
    await ingest(endpoint.slug, 5);
    const first = await api().get(`/api/endpoints/${endpoint.id}/requests?limit=2`);
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(2);
    expect(first.body.nextCursor).toBeTruthy();

    const seen = [...first.body.items];
    let cursor = first.body.nextCursor;
    while (cursor) {
      const page = await api().get(
        `/api/endpoints/${endpoint.id}/requests?limit=2&cursor=${cursor}`,
      );
      seen.push(...page.body.items);
      cursor = page.body.nextCursor;
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen.map((r) => r.id)).size).toBe(5);
    const times = seen.map((r) => r.receivedAt);
    expect([...times].sort().reverse()).toEqual(times);
    expect(seen[0]).toMatchObject({
      method: 'POST',
      sizeBytes: 7,
      signatureStatus: 'not_configured',
    });
  });

  it('rejects a bad cursor', async () => {
    const endpoint = await createEndpoint();
    const res = await api().get(`/api/endpoints/${endpoint.id}/requests?cursor=garbage`);
    expect(res.status).toBe(400);
  });

  it('filters by signature status and delivery status', async () => {
    const endpoint = await createEndpoint({
      name: 'Signed',
      signingScheme: 'github',
      signingSecret: 's',
    });
    await api().post(`/api/endpoints/${endpoint.id}/destinations`, {
      url: 'https://hooks.example.com/x',
    });
    await ingest(endpoint.slug, 2); // no signature header: invalid, not forwarded
    const invalid = await api().get(
      `/api/endpoints/${endpoint.id}/requests?signatureStatus=invalid`,
    );
    expect(invalid.body.items).toHaveLength(2);
    const valid = await api().get(`/api/endpoints/${endpoint.id}/requests?signatureStatus=valid`);
    expect(valid.body.items).toHaveLength(0);
    const pending = await api().get(
      `/api/endpoints/${endpoint.id}/requests?deliveryStatus=PENDING`,
    );
    expect(pending.body.items).toHaveLength(0);
    expect(
      (await api().get(`/api/endpoints/${endpoint.id}/requests?deliveryStatus=NOPE`)).status,
    ).toBe(400);
  });

  it('returns request detail with headers, body, deliveries and attempts', async () => {
    const endpoint = await createEndpoint();
    await api().post(`/api/endpoints/${endpoint.id}/destinations`, {
      url: 'https://hooks.example.com/x',
    });
    await ingest(endpoint.slug, 1, { Authorization: 'Bearer secret' });
    const list = await api().get(`/api/endpoints/${endpoint.id}/requests`);
    const id = list.body.items[0].id;
    const delivery = await t.prisma.delivery.findFirstOrThrow({ where: { inboundRequestId: id } });
    await t.prisma.deliveryAttempt.create({
      data: {
        deliveryId: delivery.id,
        attemptNumber: 1,
        startedAt: new Date(),
        responseStatus: 500,
        durationMs: 12,
      },
    });

    const res = await api().get(`/api/requests/${id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id,
      query: 'n=0',
      endpoint: { id: endpoint.id, name: 'Orders', signingScheme: 'none' },
      headers: { authorization: '[redacted]', 'content-type': 'application/json' },
    });
    expect(Buffer.from(res.body.bodyBase64, 'base64').toString()).toBe('{"n":0}');
    expect(res.body.deliveries[0]).toMatchObject({
      destinationUrl: 'https://hooks.example.com/x',
      attempts: [{ attemptNumber: 1, responseStatus: 500, durationMs: 12 }],
    });
    const missing = await api().get('/api/requests/00000000-0000-0000-0000-000000000000');
    expect(missing.body.code).toBe('REQUEST_NOT_FOUND');
  });
});

describe('replay and dead letters', () => {
  async function setup() {
    const endpoint = await createEndpoint();
    const destA = await api().post(`/api/endpoints/${endpoint.id}/destinations`, {
      url: 'https://hooks.example.com/a',
    });
    const destB = await api().post(`/api/endpoints/${endpoint.id}/destinations`, {
      url: 'https://hooks.example.com/b',
    });
    const ingest = await request(t.app.getHttpServer()).post(`/in/${endpoint.slug}`).send('{}');
    const deliveries = await t.prisma.delivery.findMany({
      where: { inboundRequestId: ingest.body.id },
    });
    return {
      endpoint,
      destA: destA.body,
      destB: destB.body,
      requestId: ingest.body.id as string,
      deliveries,
    };
  }

  it('refuses to replay a delivery that is still in progress', async () => {
    const { deliveries } = await setup();
    const res = await api().post(`/api/deliveries/${deliveries[0]?.id}/replay`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DELIVERY_NOT_REPLAYABLE');
  });

  it('replays a finished delivery as a new delivery without touching the old one', async () => {
    const { deliveries } = await setup();
    const original = deliveries[0];
    if (!original) throw new Error('no delivery');
    await t.prisma.delivery.update({
      where: { id: original.id },
      data: { status: 'DEAD', attemptCount: 8 },
    });
    await t.prisma.deliveryAttempt.create({
      data: {
        deliveryId: original.id,
        attemptNumber: 8,
        startedAt: new Date(),
        responseStatus: 503,
      },
    });
    const outboxBefore = await t.prisma.outboxEvent.count();

    const res = await api().post(`/api/deliveries/${original.id}/replay`);
    expect(res.status).toBe(202);
    const [replay] = res.body.deliveries;
    expect(replay).toMatchObject({ status: 'PENDING', attemptCount: 0, replayOfId: original.id });
    expect(replay.id).not.toBe(original.id);

    const old = await t.prisma.delivery.findUniqueOrThrow({
      where: { id: original.id },
      include: { attempts: true },
    });
    expect(old).toMatchObject({ status: 'DEAD', attemptCount: 8 });
    expect(old.attempts).toHaveLength(1);

    const events = await t.prisma.outboxEvent.findMany({ orderBy: { createdAt: 'asc' } });
    expect(events).toHaveLength(outboxBefore + 1);
    expect(events.at(-1)).toMatchObject({
      type: OutboxEventType.DELIVERY_SCHEDULED,
      payload: { deliveryId: replay.id, attempt: 1 },
    });
  });

  it('refuses to replay to a disabled destination', async () => {
    const { endpoint, destA, deliveries } = await setup();
    const delivery = deliveries.find((d) => d.destinationId === destA.id);
    await t.prisma.delivery.update({ where: { id: delivery?.id }, data: { status: 'SUCCEEDED' } });
    await api().patch(`/api/endpoints/${endpoint.id}/destinations/${destA.id}`, { enabled: false });
    const res = await api().post(`/api/deliveries/${delivery?.id}/replay`);
    expect(res.body.code).toBe('DELIVERY_NOT_REPLAYABLE');
  });

  it('replays a request to all enabled destinations', async () => {
    const { endpoint, destB, requestId } = await setup();
    await api().patch(`/api/endpoints/${endpoint.id}/destinations/${destB.id}`, { enabled: false });
    const res = await api().post(`/api/endpoints/${endpoint.id}/requests/${requestId}/replay`);
    expect(res.status).toBe(202);
    expect(res.body.deliveries).toHaveLength(1);
    expect(await t.prisma.delivery.count({ where: { inboundRequestId: requestId } })).toBe(3);
  });

  it('refuses to replay a request when no destination is enabled', async () => {
    const { endpoint, destA, destB, requestId } = await setup();
    for (const d of [destA, destB]) {
      await api().patch(`/api/endpoints/${endpoint.id}/destinations/${d.id}`, { enabled: false });
    }
    const res = await api().post(`/api/endpoints/${endpoint.id}/requests/${requestId}/replay`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DELIVERY_NOT_REPLAYABLE');
  });

  it('lists dead letters and bulk-replays them', async () => {
    const { deliveries } = await setup();
    for (const d of deliveries) {
      await t.prisma.delivery.update({
        where: { id: d.id },
        data: { status: 'DEAD', attemptCount: 8 },
      });
    }
    const list = await api().get('/api/deliveries?status=DEAD');
    expect(list.body.items).toHaveLength(2);
    expect(list.body.items[0]).toMatchObject({
      status: 'DEAD',
      replayed: false,
      endpoint: { name: 'Orders' },
    });

    const missing = '00000000-0000-0000-0000-000000000000';
    const bulk = await api().post('/api/deliveries/replay', {
      deliveryIds: [...deliveries.map((d) => d.id), missing],
    });
    expect(bulk.status).toBe(200);
    expect(bulk.body.replayed).toHaveLength(2);
    expect(bulk.body.skipped).toEqual([
      { deliveryId: missing, code: 'DELIVERY_NOT_FOUND', message: expect.any(String) },
    ]);

    const after = await api().get('/api/deliveries');
    expect(after.body.items.every((d: { replayed: boolean }) => d.replayed)).toBe(true);
  });

  it('validates bulk replay input', async () => {
    expect((await api().post('/api/deliveries/replay', { deliveryIds: [] })).status).toBe(400);
    expect((await api().post('/api/deliveries/replay', { deliveryIds: ['x'] })).status).toBe(400);
  });
});
