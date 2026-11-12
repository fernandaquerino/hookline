import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { LIVE_CHANNEL_PATTERN, type LiveEvent, liveChannel } from '@hookline/shared';
import { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config/app-config';

export type LiveListener = (event: LiveEvent) => void;

/**
 * Live events over Redis pub/sub, so every API instance sees events published by any API or
 * dispatcher process. Live events are best effort: the database stays the source of truth and the
 * dashboard reloads from the API after reconnecting.
 */
@Injectable()
export class LiveEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LiveEventsService.name);
  private readonly listeners = new Map<string, Set<LiveListener>>();
  private publisher: Redis | null = null;
  private subscriber: Redis | null = null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  onModuleInit(): void {
    // Fail fast instead of queueing commands in memory while Redis is unreachable.
    const publisher = new Redis(this.config.redisUrl, { enableOfflineQueue: false });
    const subscriber = new Redis(this.config.redisUrl);
    publisher.on('error', (e: Error) => this.logger.warn(`Redis publisher: ${e.message}`));
    subscriber.on('error', (e: Error) => this.logger.warn(`Redis subscriber: ${e.message}`));
    subscriber.on('pmessage', (_pattern: string, _channel: string, message: string) =>
      this.dispatch(message),
    );
    this.publisher = publisher;
    this.subscriber = subscriber;
    // Not awaited: the API (and ingest) must start even while Redis is down. ioredis
    // re-subscribes automatically when the connection comes back.
    subscriber
      .psubscribe(LIVE_CHANNEL_PATTERN)
      .catch((e: Error) => this.logger.warn(`Live subscription failed: ${e.message}`));
  }

  /** Safe even when startup failed before onModuleInit ran. */
  onModuleDestroy(): void {
    this.subscriber?.disconnect();
    this.publisher?.disconnect();
  }

  /** Publishes an event; never throws, because a missed live event must not fail a request. */
  async publish(event: LiveEvent): Promise<void> {
    try {
      if (!this.publisher) throw new Error('not connected');
      await this.publisher.publish(liveChannel(event.endpointId), JSON.stringify(event));
    } catch (error) {
      this.logger.warn(`Could not publish live event: ${(error as Error).message}`);
    }
  }

  /** Registers a listener for one endpoint; returns a function that removes it. */
  subscribe(endpointId: string, listener: LiveListener): () => void {
    const set = this.listeners.get(endpointId) ?? new Set<LiveListener>();
    set.add(listener);
    this.listeners.set(endpointId, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(endpointId);
    };
  }

  private dispatch(message: string): void {
    let event: LiveEvent;
    try {
      event = JSON.parse(message) as LiveEvent;
    } catch {
      return;
    }
    for (const listener of this.listeners.get(event.endpointId) ?? []) listener(event);
  }
}
