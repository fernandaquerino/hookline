import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  type BulkReplayInput,
  type BulkReplayResultDto,
  type DeadLetterDto,
  type DeliverySummaryDto,
  type ListDeliveriesQuery,
  type Page,
  type ReplayResultDto,
  bulkReplayInput,
  listDeliveriesQuery,
} from '@hookline/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { DeadLettersService } from './dead-letters.service';
import { ReplayService } from './replay.service';

@Controller('api')
export class DeliveriesController {
  constructor(
    private readonly replay: ReplayService,
    private readonly deadLetters: DeadLettersService,
  ) {}

  /** Dead-letter view (status defaults to DEAD). */
  @Get('deliveries')
  list(
    @Query(new ZodValidationPipe(listDeliveriesQuery)) query: ListDeliveriesQuery,
  ): Promise<Page<DeadLetterDto>> {
    return this.deadLetters.list(query);
  }

  @Post('deliveries/replay')
  @HttpCode(HttpStatus.OK)
  replayMany(
    @Body(new ZodValidationPipe(bulkReplayInput)) body: BulkReplayInput,
  ): Promise<BulkReplayResultDto> {
    return this.replay.replayMany(body.deliveryIds);
  }

  @Post('deliveries/:id/replay')
  @HttpCode(HttpStatus.ACCEPTED)
  async replayOne(@Param('id', ParseUUIDPipe) id: string): Promise<ReplayResultDto> {
    const delivery: DeliverySummaryDto = await this.replay.replayDelivery(id);
    return { deliveries: [delivery] };
  }

  @Post('endpoints/:id/requests/:reqId/replay')
  @HttpCode(HttpStatus.ACCEPTED)
  async replayRequest(
    @Param('id', ParseUUIDPipe) endpointId: string,
    @Param('reqId', ParseUUIDPipe) requestId: string,
  ): Promise<ReplayResultDto> {
    return { deliveries: await this.replay.replayRequest(endpointId, requestId) };
  }
}
