import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  type EndpointDto,
  type UpdateEndpointInput,
  createEndpointInput,
  updateEndpointInput,
} from '@hookline/shared';
import type { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { EndpointsService } from './endpoints.service';

@Controller('api/endpoints')
export class EndpointsController {
  constructor(private readonly endpoints: EndpointsService) {}

  @Get()
  list(): Promise<EndpointDto[]> {
    return this.endpoints.list();
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(createEndpointInput)) body: z.output<typeof createEndpointInput>,
  ): Promise<EndpointDto> {
    return this.endpoints.create(body);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<EndpointDto> {
    return this.endpoints.get(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateEndpointInput)) body: UpdateEndpointInput,
  ): Promise<EndpointDto> {
    return this.endpoints.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.endpoints.remove(id);
  }
}
