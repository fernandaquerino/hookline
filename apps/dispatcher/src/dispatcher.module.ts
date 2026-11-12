import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import type { RandomSource } from '@hookline/retry';
import type { Resolver } from '@hookline/ssrf';
import { ConfigModule } from './config/config.module';
import { DISPATCHER_CONFIG, type DispatcherConfig } from './config/dispatcher-config';
import { DeliveryProcessor, RANDOM_SOURCE } from './delivery/delivery-processor';
import { DeliveryWorkerService } from './delivery/delivery-worker.service';
import { HttpSender, UndiciHttpSender } from './delivery/http-sender';
import { StaleDeliveryRecovery } from './delivery/stale-delivery-recovery';
import { OutboxPollerService } from './outbox/outbox-poller.service';
import { OutboxRelayService } from './outbox/outbox-relay.service';
import { PrismaModule } from './prisma/prisma.module';
import { DeliveryEnqueuer, DeliveryQueue } from './queue/delivery-queue';

export interface DispatcherModuleOptions {
  config?: DispatcherConfig;
  /** Start the poller and the BullMQ worker. Tests turn this off to drive steps manually. */
  runBackgroundWork?: boolean;
  random?: RandomSource;
  /** DNS resolver override for the SSRF guard, for tests. */
  resolver?: Resolver;
}

@Module({})
export class DispatcherModule {
  static forRoot(options: DispatcherModuleOptions = {}): DynamicModule {
    const background: Provider[] =
      options.runBackgroundWork === false ? [] : [OutboxPollerService, DeliveryWorkerService];
    return {
      module: DispatcherModule,
      imports: [ConfigModule.forRoot(options.config), PrismaModule],
      providers: [
        DeliveryQueue,
        { provide: DeliveryEnqueuer, useExisting: DeliveryQueue },
        {
          provide: HttpSender,
          inject: [DISPATCHER_CONFIG],
          useFactory: (config: DispatcherConfig) =>
            new UndiciHttpSender({
              allowPrivateDestinations: config.allowPrivateDestinations,
              resolver: options.resolver,
            }),
        },
        { provide: RANDOM_SOURCE, useValue: options.random ?? Math.random },
        DeliveryProcessor,
        StaleDeliveryRecovery,
        OutboxRelayService,
        ...background,
      ],
      exports: [DeliveryProcessor, OutboxRelayService, StaleDeliveryRecovery, DeliveryQueue],
    };
  }
}
