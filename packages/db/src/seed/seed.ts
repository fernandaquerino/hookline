import { DeliveryStatus, PrismaClient, SignatureStatus, SigningScheme } from '@prisma/client';
import { encryptSecret } from '../secret-box';
import {
  githubPingPayload,
  githubPushPayload,
  orderCreatedForm,
  stripeCheckoutPayload,
} from './sample-payloads';

const DEMO_SLUG_PREFIX = 'demo-';
const LOCAL_DESTINATION = 'http://localhost:4010/webhooks';

interface SampleRequest {
  body: string;
  contentType: string;
  headers: Record<string, string>;
  signatureStatus: SignatureStatus;
  dedupeKey?: string;
  delivery: { status: DeliveryStatus; responses: Array<number | null> };
  minutesAgo: number;
}

/** Replaces all demo endpoints (slug prefix `demo-`) with fresh made-up data. */
export async function seed(prisma: PrismaClient, encryptionKey: Buffer): Promise<void> {
  await prisma.endpoint.deleteMany({ where: { slug: { startsWith: DEMO_SLUG_PREFIX } } });

  await createEndpoint(prisma, {
    name: 'GitHub demo',
    slug: 'demo-github-7f3k2q',
    signingScheme: SigningScheme.github,
    signingSecretEnc: encryptSecret('demo-github-secret', encryptionKey),
    dedupeHeader: 'x-github-delivery',
    requests: [
      {
        body: JSON.stringify(githubPingPayload),
        contentType: 'application/json',
        headers: { 'x-github-event': 'ping', 'x-github-delivery': 'demo-delivery-0001' },
        signatureStatus: SignatureStatus.valid,
        dedupeKey: 'demo-delivery-0001',
        delivery: { status: DeliveryStatus.SUCCEEDED, responses: [200] },
        minutesAgo: 90,
      },
      {
        body: JSON.stringify(githubPushPayload),
        contentType: 'application/json',
        headers: { 'x-github-event': 'push', 'x-github-delivery': 'demo-delivery-0002' },
        signatureStatus: SignatureStatus.valid,
        dedupeKey: 'demo-delivery-0002',
        delivery: { status: DeliveryStatus.SUCCEEDED, responses: [503, null, 200] },
        minutesAgo: 30,
      },
    ],
  });

  await createEndpoint(prisma, {
    name: 'Stripe test mode demo',
    slug: 'demo-stripe-9m4x1v',
    signingScheme: SigningScheme.stripe,
    signingSecretEnc: encryptSecret('whsec_demo_only_not_a_real_secret', encryptionKey),
    dedupeHeader: null,
    requests: [
      {
        body: JSON.stringify(stripeCheckoutPayload),
        contentType: 'application/json',
        headers: { 'stripe-signature': 't=1700000000,v1=deadbeef' },
        signatureStatus: SignatureStatus.invalid,
        delivery: { status: DeliveryStatus.DEAD, responses: [] },
        minutesAgo: 20,
      },
    ],
  });

  await createEndpoint(prisma, {
    name: 'Orders service (unsigned)',
    slug: 'demo-orders-2b8n6c',
    signingScheme: SigningScheme.none,
    signingSecretEnc: null,
    dedupeHeader: null,
    requests: [
      {
        body: orderCreatedForm,
        contentType: 'application/x-www-form-urlencoded',
        headers: {},
        signatureStatus: SignatureStatus.not_configured,
        delivery: {
          status: DeliveryStatus.DEAD,
          responses: [500, 500, 502, null, 500, 503, 500, 500],
        },
        minutesAgo: 10,
      },
    ],
  });
}

interface EndpointSeed {
  name: string;
  slug: string;
  signingScheme: SigningScheme;
  signingSecretEnc: string | null;
  dedupeHeader: string | null;
  requests: SampleRequest[];
}

async function createEndpoint(prisma: PrismaClient, seedData: EndpointSeed): Promise<void> {
  const { requests, ...endpointData } = seedData;
  const endpoint = await prisma.endpoint.create({
    data: {
      ...endpointData,
      destinations: { create: [{ url: LOCAL_DESTINATION }] },
    },
    include: { destinations: true },
  });
  const destination = endpoint.destinations[0];
  if (!destination) throw new Error('seed: destination was not created');

  for (const request of requests) {
    const receivedAt = new Date(Date.now() - request.minutesAgo * 60_000);
    const created = await prisma.inboundRequest.create({
      data: {
        endpointId: endpoint.id,
        method: 'POST',
        path: `/in/${endpoint.slug}`,
        query: '',
        headers: {
          'content-type': request.contentType,
          'user-agent': 'hookline-seed/1.0',
          ...request.headers,
        },
        body: Buffer.from(request.body, 'utf8'),
        contentType: request.contentType,
        signatureStatus: request.signatureStatus,
        dedupeKey: request.dedupeKey ?? null,
        receivedAt,
      },
    });
    await prisma.delivery.create({
      data: {
        inboundRequestId: created.id,
        destinationId: destination.id,
        status: request.delivery.status,
        attemptCount: request.delivery.responses.length,
        attempts: {
          create: request.delivery.responses.map((status, index) => ({
            attemptNumber: index + 1,
            startedAt: new Date(receivedAt.getTime() + index * 5_000),
            durationMs: status === null ? 10_000 : 42,
            responseStatus: status,
            responseBodySnippet: status === null ? null : status < 300 ? 'ok' : 'upstream error',
            error: status === null ? 'Timeout after 10000 ms' : null,
          })),
        },
      },
    });
  }
}
