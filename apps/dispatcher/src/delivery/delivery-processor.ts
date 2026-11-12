import { Inject, Injectable, Logger } from '@nestjs/common';
import { DeliveryStatus, type Prisma } from '@hookline/db';
import {
  type AttemptResult,
  type NextStep,
  type RandomSource,
  classifyAttempt,
  parseRetryAfterMs,
  planNextAttempt,
} from '@hookline/retry';
import {
  type DeliveryJobData,
  type DeliveryScheduledPayload,
  OutboxEventType,
} from '@hookline/shared';
import { DISPATCHER_CONFIG, type DispatcherConfig } from '../config/dispatcher-config';
import { PrismaService } from '../prisma/prisma.service';
import { buildForwardHeaders, storedHeaders } from './forward-headers';
import { HttpSender, type SendResult } from './http-sender';

export const RANDOM_SOURCE = Symbol('RANDOM_SOURCE');

export type ProcessOutcome = 'skipped' | 'succeeded' | 'retry_scheduled' | 'dead' | 'superseded';

export interface AttemptRecord {
  startedAt: Date;
  durationMs: number | null;
  responseStatus: number | null;
  responseBodySnippet: string | null;
  error: string | null;
}

/** Runs one delivery attempt and records its result. */
@Injectable()
export class DeliveryProcessor {
  private readonly logger = new Logger(DeliveryProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sender: HttpSender,
    @Inject(DISPATCHER_CONFIG) private readonly config: DispatcherConfig,
    @Inject(RANDOM_SOURCE) private readonly random: RandomSource,
  ) {}

  async process(job: DeliveryJobData): Promise<ProcessOutcome> {
    if (!(await this.claim(job))) return 'skipped';

    const delivery = await this.prisma.delivery.findUniqueOrThrow({
      where: { id: job.deliveryId },
      include: { destination: true, inboundRequest: true },
    });
    const { destination, inboundRequest } = delivery;
    const startedAt = new Date();

    let result: SendResult;
    if (!destination.enabled) {
      result = { kind: 'error', error: 'Destination is disabled', durationMs: 0, blocked: true };
    } else {
      result = await this.sender.send({
        url: destination.url,
        method: inboundRequest.method,
        headers: buildForwardHeaders(storedHeaders(inboundRequest.headers), {
          deliveryId: delivery.id,
          attempt: job.attempt,
        }),
        body: Buffer.from(inboundRequest.body),
        timeoutMs: destination.timeoutMs,
      });
    }

    const step = this.plan(job.attempt, destination.maxAttempts, result);
    const recorded = await this.record(job, toAttemptRecord(startedAt, result), step);
    if (!recorded) return 'superseded';
    return outcomeOf(step);
  }

  /**
   * Records an attempt and moves the delivery to its next state, in one transaction. The update
   * only applies while the delivery is still IN_FLIGHT for this attempt, so a recovered or
   * duplicated job cannot overwrite a newer state. Returns false when it no longer applies.
   */
  async record(job: DeliveryJobData, attempt: AttemptRecord, step: NextStep): Promise<boolean> {
    const nextAttemptAt = step.kind === 'retry' ? new Date(Date.now() + step.delayMs) : null;
    const status: DeliveryStatus =
      step.kind === 'succeeded'
        ? DeliveryStatus.SUCCEEDED
        : step.kind === 'retry'
          ? DeliveryStatus.FAILED_RETRYING
          : DeliveryStatus.DEAD;

    return this.prisma.$transaction(async (tx) => {
      const moved = await tx.delivery.updateMany({
        where: {
          id: job.deliveryId,
          status: DeliveryStatus.IN_FLIGHT,
          attemptCount: job.attempt,
        },
        data: { status, nextAttemptAt },
      });
      if (moved.count === 0) return false;

      await tx.deliveryAttempt.create({
        data: { deliveryId: job.deliveryId, attemptNumber: job.attempt, ...attempt },
      });
      if (nextAttemptAt) {
        const payload: DeliveryScheduledPayload = {
          deliveryId: job.deliveryId,
          attempt: job.attempt + 1,
          notBefore: nextAttemptAt.toISOString(),
        };
        await tx.outboxEvent.create({
          data: {
            type: OutboxEventType.DELIVERY_SCHEDULED,
            payload: payload satisfies Prisma.InputJsonObject,
          },
        });
      }
      return true;
    });
  }

  plan(attemptNumber: number, maxAttempts: number, result: SendResult): NextStep {
    const attemptResult: AttemptResult =
      result.kind === 'response' ? { status: result.status } : { networkError: true };
    // A refused destination will not become allowed by retrying.
    const outcome =
      result.kind === 'error' && result.blocked ? 'permanent' : classifyAttempt(attemptResult);
    return planNextAttempt({
      attemptNumber,
      maxAttempts,
      outcome,
      retryAfterMs:
        result.kind === 'response' && (result.status === 429 || result.status >= 500)
          ? parseRetryAfterMs(result.retryAfter)
          : null,
      backoff: { baseMs: this.config.retryBaseMs, capMs: this.config.retryCapMs },
      random: this.random,
    });
  }

  /**
   * Atomically moves the delivery to IN_FLIGHT for this attempt. Fails (returns false) for jobs
   * that are stale or duplicated: the delivery already finished or moved past this attempt.
   */
  private async claim(job: DeliveryJobData): Promise<boolean> {
    const claimed = await this.prisma.delivery.updateMany({
      where: {
        id: job.deliveryId,
        attemptCount: job.attempt - 1,
        status: { in: [DeliveryStatus.PENDING, DeliveryStatus.FAILED_RETRYING] },
      },
      data: { status: DeliveryStatus.IN_FLIGHT, attemptCount: job.attempt, nextAttemptAt: null },
    });
    if (claimed.count === 0) {
      this.logger.debug(`Skipping stale job ${job.deliveryId} attempt ${job.attempt}`);
    }
    return claimed.count === 1;
  }
}

function toAttemptRecord(startedAt: Date, result: SendResult): AttemptRecord {
  return result.kind === 'response'
    ? {
        startedAt,
        durationMs: result.durationMs,
        responseStatus: result.status,
        responseBodySnippet: result.bodySnippet,
        error: null,
      }
    : {
        startedAt,
        durationMs: result.durationMs,
        responseStatus: null,
        responseBodySnippet: null,
        error: result.error,
      };
}

function outcomeOf(step: NextStep): ProcessOutcome {
  if (step.kind === 'succeeded') return 'succeeded';
  return step.kind === 'retry' ? 'retry_scheduled' : 'dead';
}
