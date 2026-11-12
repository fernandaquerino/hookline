import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@hookline/db';
import { DISPATCHER_CONFIG, type DispatcherConfig } from '../config/dispatcher-config';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(DISPATCHER_CONFIG) config: DispatcherConfig) {
    super({ datasources: { db: { url: config.databaseUrl } } });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
