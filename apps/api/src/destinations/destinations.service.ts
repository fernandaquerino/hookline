import { Injectable } from '@nestjs/common';
import {
  type DestinationDto,
  ErrorCode,
  type UpdateDestinationInput,
  type createDestinationInput,
} from '@hookline/shared';
import type { z } from 'zod';
import { ApiException } from '../common/api-exception';
import { toDestinationDto } from '../common/mappers';
import { EndpointsService } from '../endpoints/endpoints.service';
import { PrismaService } from '../prisma/prisma.service';
import { DestinationPolicy } from './destination-policy';

@Injectable()
export class DestinationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly endpoints: EndpointsService,
    private readonly policy: DestinationPolicy,
  ) {}

  async create(
    endpointId: string,
    input: z.output<typeof createDestinationInput>,
  ): Promise<DestinationDto> {
    await this.endpoints.assertExists(endpointId);
    await this.policy.assertAllowed(input.url);
    const destination = await this.prisma.destination.create({ data: { endpointId, ...input } });
    return toDestinationDto(destination);
  }

  async update(
    endpointId: string,
    destinationId: string,
    input: UpdateDestinationInput,
  ): Promise<DestinationDto> {
    await this.assertBelongs(endpointId, destinationId);
    if (input.url !== undefined) await this.policy.assertAllowed(input.url);
    const destination = await this.prisma.destination.update({
      where: { id: destinationId },
      data: input,
    });
    return toDestinationDto(destination);
  }

  /** Deleting a destination also deletes its delivery history (cascade). */
  async remove(endpointId: string, destinationId: string): Promise<void> {
    await this.assertBelongs(endpointId, destinationId);
    await this.prisma.destination.delete({ where: { id: destinationId } });
  }

  private async assertBelongs(endpointId: string, destinationId: string): Promise<void> {
    const found = await this.prisma.destination.count({ where: { id: destinationId, endpointId } });
    if (found === 0) {
      throw ApiException.notFound(
        ErrorCode.DESTINATION_NOT_FOUND,
        `No destination ${destinationId} on endpoint ${endpointId}`,
      );
    }
  }
}
