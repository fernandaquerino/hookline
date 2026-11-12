import { encryptSecret, type SigningScheme } from '@hookline/db';
import { OutboxEventType } from '@hookline/shared';
import { signGithub } from '@hookline/signatures';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './test-app';
import { resetDatabase } from './test-db';

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp();
});

afterAll(async () => {
  await t.app.close();
});

beforeEach(async () => {
  await resetDatabase(t.prisma);
});

interface EndpointOptions {
  scheme?: SigningScheme;
  secret?: string;
  dedupeHeader?: string;
  forwardInvalidSignatures?: boolean;
  destinations?: Array<{ enabled: boolean }>;
}

async function createEndpoint(options: EndpointOptions = {}) {
  return t.prisma.endpoint.create({
    data: {
      name: 'Test endpoint',
      slug: `test-${Math.random().toString(36).slice(2, 10)}`,
      signingScheme: options.scheme ?? 'none',
      signingSecretEnc: options.secret
        ? encryptSecret(options.secret, t.config.encryptionKey)
        : null,
      dedupeHeader: options.dedupeHeader ?? null,
      forwardInvalidSignatures: options.forwardInvalidSignatures ?? false,
      destinations: {
        create: (options.destinations ?? [{ enabled: true }]).map((d, i) => ({
          url: `http://localhost:9${i}00/hook`,
          enabled: d.enabled,
        })),
      },
    },
  });
}

const http = () => request(t.app.getHttpServer());

describe('ingest: basics', () => {
  it('returns 404 with a stable code for an unknown slug', async () => {
    const res = await http().post('/in/does-not-exist').send({ a: 1 });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ code: 'ENDPOINT_NOT_FOUND', message: expect.any(String) });
  });

  it('stores the request, one delivery per enabled destination and one outbox event', async () => {
    const endpoint = await createEndpoint({
      destinations: [{ enabled: true }, { enabled: false }, { enabled: true }],
    });
    const res = await http()
      .post(`/in/${endpoint.slug}?source=test&x=1`)
      .set('Content-Type', 'application/json')
      .set('X-Custom', 'kept')
      .send('{"event":"order.created","id":1}');

    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ signatureStatus: 'not_configured', deliveries: 2 });

    const stored = await t.prisma.inboundRequest.findUniqueOrThrow({
      where: { id: res.body.id },
      include: { deliveries: true },
    });
    expect(stored.method).toBe('POST');
    expect(stored.path).toBe(`/in/${endpoint.slug}`);
    expect(stored.query).toBe('source=test&x=1');
    expect(stored.contentType).toBe('application/json');
    expect(Buffer.from(stored.body).toString('utf8')).toBe('{"event":"order.created","id":1}');
    expect(stored.headers).toMatchObject({ 'x-custom': 'kept' });
    expect(stored.deliveries).toHaveLength(2);
    expect(stored.deliveries.every((d) => d.status === 'PENDING' && d.attemptCount === 0)).toBe(
      true,
    );

    const events = await t.prisma.outboxEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: OutboxEventType.REQUEST_RECEIVED,
      publishedAt: null,
      payload: {
        requestId: stored.id,
        endpointId: endpoint.id,
        deliveryIds: expect.arrayContaining(stored.deliveries.map((d) => d.id)),
      },
    });
  });

  it('accepts any method and preserves binary bodies byte for byte', async () => {
    const endpoint = await createEndpoint();
    const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const res = await http()
      .put(`/in/${endpoint.slug}`)
      .set('Content-Type', 'application/octet-stream')
      .send(bytes);
    expect(res.status).toBe(202);
    const stored = await t.prisma.inboundRequest.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(stored.method).toBe('PUT');
    expect(Buffer.from(stored.body).equals(bytes)).toBe(true);

    const get = await http().get(`/in/${endpoint.slug}`);
    expect(get.status).toBe(202);
  });

  it('redacts Authorization, Cookie and REDACT_HEADERS before storage', async () => {
    const endpoint = await createEndpoint();
    const res = await http()
      .post(`/in/${endpoint.slug}`)
      .set('Authorization', 'Bearer super-secret')
      .set('Cookie', 'session=abc')
      .set('X-Api-Key', 'key-123')
      .set('X-Safe', 'visible')
      .send('{}');
    expect(res.status).toBe(202);
    const stored = await t.prisma.inboundRequest.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(stored.headers).toMatchObject({
      authorization: '[redacted]',
      cookie: '[redacted]',
      'x-api-key': '[redacted]',
      'x-safe': 'visible',
    });
    expect(JSON.stringify(stored.headers)).not.toMatch(/super-secret|session=abc|key-123/);
  });
});

describe('ingest: body size limit', () => {
  it('accepts exactly 256 KB', async () => {
    const endpoint = await createEndpoint();
    const res = await http()
      .post(`/in/${endpoint.slug}`)
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.alloc(256 * 1024, 'a'));
    expect(res.status).toBe(202);
  });

  it('rejects more than 256 KB with 413 and stores nothing', async () => {
    const endpoint = await createEndpoint();
    const res = await http()
      .post(`/in/${endpoint.slug}`)
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.alloc(256 * 1024 + 1, 'a'));
    expect(res.status).toBe(413);
    expect(res.body.code).toBe('PAYLOAD_TOO_LARGE');
    expect(await t.prisma.inboundRequest.count()).toBe(0);
    expect(await t.prisma.outboxEvent.count()).toBe(0);
  });

  it('rejects an oversized chunked body without Content-Length', async () => {
    const endpoint = await createEndpoint();
    const req = http()
      .post(`/in/${endpoint.slug}`)
      .set('Content-Type', 'application/octet-stream')
      .set('Transfer-Encoding', 'chunked');
    for (let i = 0; i < 40; i++) req.write(Buffer.alloc(8 * 1024, 'b'));
    const res = await req;
    expect(res.status).toBe(413);
    expect(await t.prisma.inboundRequest.count()).toBe(0);
  });
});

describe('ingest: signatures', () => {
  const secret = 'test-github-secret';
  const body = '{"zen":"Design for failure."}';

  it('stores a valid signature and creates deliveries', async () => {
    const endpoint = await createEndpoint({ scheme: 'github', secret });
    const res = await http()
      .post(`/in/${endpoint.slug}`)
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signGithub(secret, body))
      .send(body);
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ signatureStatus: 'valid', deliveries: 1 });
  });

  it('stores an invalid signature but does not forward it', async () => {
    const endpoint = await createEndpoint({ scheme: 'github', secret });
    const res = await http()
      .post(`/in/${endpoint.slug}`)
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signGithub('wrong-secret', body))
      .send(body);
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ signatureStatus: 'invalid', deliveries: 0 });
    const stored = await t.prisma.inboundRequest.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(stored.signatureStatus).toBe('invalid');
    expect(await t.prisma.delivery.count()).toBe(0);
    // The outbox event is still written, with no deliveries, so the stream sees the request.
    expect(await t.prisma.outboxEvent.count()).toBe(1);
  });

  it('forwards an invalid signature when the endpoint allows it', async () => {
    const endpoint = await createEndpoint({
      scheme: 'github',
      secret,
      forwardInvalidSignatures: true,
    });
    const res = await http()
      .post(`/in/${endpoint.slug}`)
      .set('Content-Type', 'application/json')
      .send(body);
    expect(res.body).toMatchObject({ signatureStatus: 'invalid', deliveries: 1 });
  });
});

describe('ingest: dedupe', () => {
  it('returns 200 for a repeated dedupe header value and creates no new deliveries', async () => {
    const endpoint = await createEndpoint({ dedupeHeader: 'X-GitHub-Delivery' });
    const send = (id: string) =>
      http().post(`/in/${endpoint.slug}`).set('X-GitHub-Delivery', id).send('{"n":1}');

    const first = await send('delivery-1');
    expect(first.status).toBe(202);
    const second = await send('delivery-1');
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ id: first.body.id, duplicate: true });
    const third = await send('delivery-2');
    expect(third.status).toBe(202);

    expect(await t.prisma.inboundRequest.count()).toBe(2);
    expect(await t.prisma.delivery.count()).toBe(2);
    expect(await t.prisma.outboxEvent.count()).toBe(2);
  });

  it('does not dedupe requests that lack the header', async () => {
    const endpoint = await createEndpoint({ dedupeHeader: 'x-github-delivery' });
    await http().post(`/in/${endpoint.slug}`).send('{}').expect(202);
    await http().post(`/in/${endpoint.slug}`).send('{}').expect(202);
    expect(await t.prisma.inboundRequest.count()).toBe(2);
  });

  it('lets exactly one of several concurrent duplicates through', async () => {
    const endpoint = await createEndpoint({ dedupeHeader: 'x-github-delivery' });
    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        http().post(`/in/${endpoint.slug}`).set('X-GitHub-Delivery', 'same').send('{}'),
      ),
    );
    const statuses = responses.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 200, 200, 200, 200, 202]);
    expect(await t.prisma.inboundRequest.count()).toBe(1);
    expect(await t.prisma.delivery.count()).toBe(1);
  });

  it('does not let a request with an invalid signature claim a dedupe key', async () => {
    const secret = 's3cret';
    const endpoint = await createEndpoint({
      scheme: 'github',
      secret,
      dedupeHeader: 'x-github-delivery',
    });
    const body = '{"ok":true}';
    const forged = await http()
      .post(`/in/${endpoint.slug}`)
      .set('X-GitHub-Delivery', 'abc')
      .set('X-Hub-Signature-256', signGithub('attacker', body))
      .send(body);
    expect(forged.status).toBe(202);
    const genuine = await http()
      .post(`/in/${endpoint.slug}`)
      .set('X-GitHub-Delivery', 'abc')
      .set('X-Hub-Signature-256', signGithub(secret, body))
      .send(body);
    expect(genuine.status).toBe(202);
    expect(genuine.body).toMatchObject({ signatureStatus: 'valid', deliveries: 1 });
  });
});

describe('ingest: transactional outbox', () => {
  afterAll(async () => {
    await t.prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS fail_outbox ON "OutboxEvent"');
    await t.prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS fail_outbox_insert()');
  });

  it('rolls back the request and deliveries when the outbox write fails', async () => {
    const endpoint = await createEndpoint();
    await t.prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION fail_outbox_insert() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'simulated outbox failure'; END; $$ LANGUAGE plpgsql`);
    await t.prisma.$executeRawUnsafe(
      'CREATE TRIGGER fail_outbox BEFORE INSERT ON "OutboxEvent" FOR EACH ROW EXECUTE FUNCTION fail_outbox_insert()',
    );

    const res = await http().post(`/in/${endpoint.slug}`).send('{}');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ code: 'INTERNAL_ERROR', message: 'Internal server error' });
    expect(await t.prisma.inboundRequest.count()).toBe(0);
    expect(await t.prisma.delivery.count()).toBe(0);
  });
});
