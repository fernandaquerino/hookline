import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { DISPATCHER_CONFIG, type DispatcherConfig } from '../config/dispatcher-config';
import { RetentionService } from './retention.service';

/**
 * Runs retention shortly after startup and then every RETENTION_INTERVAL_MS. Running it on more
 * than one dispatcher is harmless: the deletes are idempotent.
 */
@Injectable()
export class RetentionSchedulerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RetentionSchedulerService.name);
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<unknown> | null = null;

  constructor(
    private readonly retention: RetentionService,
    @Inject(DISPATCHER_CONFIG) private readonly config: DispatcherConfig,
  ) {}

  onApplicationBootstrap(): void {
    this.schedule(Math.min(30_000, this.config.retentionIntervalMs));
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.running;
  }

  private schedule(delayMs: number): void {
    this.timer = setTimeout(() => {
      this.running = this.retention
        .runOnce()
        .catch((error: unknown) =>
          this.logger.error(`Retention failed: ${error instanceof Error ? error.message : error}`),
        )
        .finally(() => {
          this.running = null;
          if (this.timer) this.schedule(this.config.retentionIntervalMs);
        });
    }, delayMs);
    this.timer.unref();
  }
}
