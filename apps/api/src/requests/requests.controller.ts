import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  type ListRequestsQuery,
  type Page,
  type RequestDetailDto,
  type RequestSummaryDto,
  listRequestsQuery,
} from '@hookline/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequestsService } from './requests.service';

@Controller('api')
export class RequestsController {
  constructor(private readonly requests: RequestsService) {}

  @Get('endpoints/:id/requests')
  list(
    @Param('id', ParseUUIDPipe) endpointId: string,
    @Query(new ZodValidationPipe(listRequestsQuery)) query: ListRequestsQuery,
  ): Promise<Page<RequestSummaryDto>> {
    return this.requests.list(endpointId, query);
  }

  @Get('requests/:id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<RequestDetailDto> {
    return this.requests.get(id);
  }
}
