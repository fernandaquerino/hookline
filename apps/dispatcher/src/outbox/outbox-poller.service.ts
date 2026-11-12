import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { DISPATCHER_CONFIG, type DispatcherConfig } from '../config/dispatcher-config';
import { StaleDeliveryRecovery } from '../delivery/stale-delivery-recovery';
import { OutboxRelayService } from './outbox-relay.service';

/** Runs the outbox relay on a fixed interval, plus periodic recovery of interrupted deliveries. */
@Injectable()
export class OutboxPollerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxPollerService.name);
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private stopped = false;
  private lastRecoveryMs = 0;

  constructor(
    private readonly relay: OutboxRelayService,
    private readonly recovery: StaleDeliveryRecovery,
    @Inject(DISPATCHER_CONFIG) private readonly config: DispatcherConfig,
  ) {}

  onApplicationBootstrap(): void {
    this.schedule(0);
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.running;
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.running = this.tick().finally(() => {
        this.running = null;
        this.schedule(this.config.outboxPollMs);
      });
    }, delayMs);
  }

  private async tick(): Promise<void> {
    try {
      await this.relay.drain();
      const now = Date.now();
      if (now - this.lastRecoveryMs >= this.config.staleInFlightMs / 2) {
        this.lastRecoveryMs = now;
        await this.recovery.recover();
      }
    } catch (error) {
      this.logger.error(`Outbox relay failed: ${error instanceof Error ? error.message : error}`);
    }
  }
}
