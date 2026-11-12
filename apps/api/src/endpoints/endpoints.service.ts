import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { type Destination, type Endpoint, type Prisma, encryptSecret } from '@hookline/db';
import {
  type EndpointDto,
  ErrorCode,
  type UpdateEndpointInput,
  createEndpointInput,
} from '@hookline/shared';
import type { z } from 'zod';
import { ApiException } from '../common/api-exception';
import { toEndpointDto } from '../common/mappers';
import { isUniqueViolation } from '../common/prisma-errors';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';

type EndpointWithRelations = Endpoint & {
  destinations: Destination[];
  requests: Array<{ receivedAt: Date }>;
};

const INCLUDE = {
  destinations: { orderBy: { createdAt: 'asc' } },
  requests: { orderBy: { receivedAt: 'desc' }, take: 1, select: { receivedAt: true } },
} satisfies Prisma.EndpointInclude;

/** 12 URL-safe characters (72 random bits): unguessable, short enough to read. */
function randomSlug(): string {
  return randomBytes(9).toString('base64url');
}

@Injectable()
export class EndpointsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async list(): Promise<EndpointDto[]> {
    const endpoints = await this.prisma.endpoint.findMany({
      include: INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return endpoints.map((e) => this.toDto(e));
  }

  async get(id: string): Promise<EndpointDto> {
    const endpoint = await this.prisma.endpoint.findUnique({ where: { id }, include: INCLUDE });
    if (!endpoint) throw notFound(id);
    return this.toDto(endpoint);
  }

  async assertExists(id: string): Promise<void> {
    const found = await this.prisma.endpoint.count({ where: { id } });
    if (found === 0) throw notFound(id);
  }

  async create(input: z.output<typeof createEndpointInput>): Promise<EndpointDto> {
    for (let attempt = 0; ; attempt++) {
      try {
        const endpoint = await this.prisma.endpoint.create({
          data: {
            name: input.name,
            slug: randomSlug(),
            signingScheme: input.signingScheme,
            signingSecretEnc: this.encrypt(input.signingSecret),
            dedupeHeader: input.dedupeHeader ?? null,
            forwardInvalidSignatures: input.forwardInvalidSignatures,
          },
          include: INCLUDE,
        });
        return this.toDto(endpoint);
      } catch (error) {
        // A slug collision is astronomically unlikely; retry a couple of times anyway.
        if (!isUniqueViolation(error) || attempt >= 2) throw error;
      }
    }
  }

  async update(id: string, input: UpdateEndpointInput): Promise<EndpointDto> {
    const current = await this.prisma.endpoint.findUnique({ where: { id } });
    if (!current) throw notFound(id);

    const scheme = input.signingScheme ?? current.signingScheme;
    const hasSecret = input.signingSecret !== undefined || current.signingSecretEnc !== null;
    if (scheme !== 'none' && !hasSecret) {
      throw ApiException.badRequest(
        ErrorCode.VALIDATION_FAILED,
        'signingSecret: is required when signingScheme is not none',
      );
    }

    const endpoint = await this.prisma.endpoint.update({
      where: { id },
      data: {
        name: input.name,
        signingScheme: input.signingScheme,
        // Switching to "none" drops the stored secret.
        signingSecretEnc:
          scheme === 'none'
            ? null
            : input.signingSecret !== undefined
              ? this.encrypt(input.signingSecret)
              : undefined,
        dedupeHeader: input.dedupeHeader,
        forwardInvalidSignatures: input.forwardInvalidSignatures,
      },
      include: INCLUDE,
    });
    return this.toDto(endpoint);
  }

  async remove(id: string): Promise<void> {
    const deleted = await this.prisma.endpoint.deleteMany({ where: { id } });
    if (deleted.count === 0) throw notFound(id);
  }

  private encrypt(secret: string | undefined): string | null {
    return secret === undefined ? null : encryptSecret(secret, this.config.encryptionKey);
  }

  private toDto(endpoint: EndpointWithRelations): EndpointDto {
    return toEndpointDto(
      endpoint,
      this.config.publicIngestBaseUrl,
      endpoint.requests[0]?.receivedAt ?? null,
    );
  }
}

function notFound(id: string): ApiException {
  return ApiException.notFound(ErrorCode.ENDPOINT_NOT_FOUND, `No endpoint with id ${id}`);
}
