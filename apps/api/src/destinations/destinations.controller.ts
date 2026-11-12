import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  type DestinationDto,
  type UpdateDestinationInput,
  createDestinationInput,
  updateDestinationInput,
} from '@hookline/shared';
import type { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { DestinationsService } from './destinations.service';

@Controller('api/endpoints/:id/destinations')
export class DestinationsController {
  constructor(private readonly destinations: DestinationsService) {}

  @Post()
  create(
    @Param('id', ParseUUIDPipe) endpointId: string,
    @Body(new ZodValidationPipe(createDestinationInput))
    body: z.output<typeof createDestinationInput>,
  ): Promise<DestinationDto> {
    return this.destinations.create(endpointId, body);
  }

  @Patch(':destId')
  update(
    @Param('id', ParseUUIDPipe) endpointId: string,
    @Param('destId', ParseUUIDPipe) destinationId: string,
    @Body(new ZodValidationPipe(updateDestinationInput)) body: UpdateDestinationInput,
  ): Promise<DestinationDto> {
    return this.destinations.update(endpointId, destinationId, body);
  }

  @Delete(':destId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) endpointId: string,
    @Param('destId', ParseUUIDPipe) destinationId: string,
  ): Promise<void> {
    return this.destinations.remove(endpointId, destinationId);
  }
}
