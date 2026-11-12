import { Inject, Injectable } from '@nestjs/common';
import { type Destination, type Endpoint, decryptSecret } from '@hookline/db';
import { ErrorCode } from '@hookline/shared';
import { getHeader, verifySignature, type VerifyResult } from '@hookline/signatures';
import { ApiException } from '../common/api-exception';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { IngestStore } from './ingest.store';
import type { IngestInput, IngestResult } from './ingest.types';
import { redactHeaders } from './redact';

const MAX_DEDUPE_KEY_LENGTH = 512;

export type IngestEndpoint = Endpoint & { destinations: Destination[] };

@Injectable()
export class IngestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: IngestStore,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async findEndpoint(slug: string): Promise<IngestEndpoint> {
    const endpoint = await this.prisma.endpoint.findUnique({
      where: { slug },
      include: { destinations: { where: { enabled: true }, orderBy: { createdAt: 'asc' } } },
    });
    if (!endpoint) {
      throw ApiException.notFound(ErrorCode.ENDPOINT_NOT_FOUND, `No endpoint with slug "${slug}"`);
    }
    return endpoint;
  }

  async ingest(endpoint: IngestEndpoint, input: IngestInput): Promise<IngestResult> {
    const signature = this.verify(endpoint, input);
    const signatureOk = signature.status !== 'invalid';
    const forward = signatureOk || endpoint.forwardInvalidSignatures;

    // An unverified request must not be able to claim a dedupe key and block the genuine one.
    const dedupeKey = signatureOk ? this.dedupeKey(endpoint, input) : null;

    const stored = await this.store.store({
      endpointId: endpoint.id,
      method: input.method,
      path: input.path,
      query: input.query,
      headers: redactHeaders(input.headers, this.config.redactHeaders),
      body: input.body,
      contentType: getHeader(input.headers, 'content-type') ?? null,
      signatureStatus: signature.status,
      dedupeKey,
      destinationIds: forward ? endpoint.destinations.map((d) => d.id) : [],
    });

    if (stored === null) {
      // store() only reports a duplicate when a dedupe key was set.
      const requestId = dedupeKey ? await this.store.findByDedupeKey(endpoint.id, dedupeKey) : null;
      return { kind: 'duplicate', requestId };
    }
    return {
      kind: 'accepted',
      requestId: stored.requestId,
      signatureStatus: signature.status,
      deliveryIds: stored.deliveryIds,
    };
  }

  private verify(endpoint: Endpoint, input: IngestInput): VerifyResult {
    const secret = endpoint.signingSecretEnc
      ? decryptSecret(endpoint.signingSecretEnc, this.config.encryptionKey)
      : null;
    return verifySignature({
      scheme: endpoint.signingScheme,
      secret,
      headers: input.headers,
      body: input.body,
    });
  }

  private dedupeKey(endpoint: Endpoint, input: IngestInput): string | null {
    if (!endpoint.dedupeHeader) return null;
    const value = getHeader(input.headers, endpoint.dedupeHeader)?.trim();
    return value ? value.slice(0, MAX_DEDUPE_KEY_LENGTH) : null;
  }
}
