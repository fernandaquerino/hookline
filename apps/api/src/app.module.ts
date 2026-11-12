import { type DynamicModule, Module } from '@nestjs/common';
import type { Resolver } from '@hookline/ssrf';
import { AuthModule } from './auth/auth.module';
import type { AppConfig } from './config/app-config';
import { ConfigModule } from './config/config.module';
import { DNS_RESOLVER } from './destinations/destination-policy';
import { IngestModule } from './ingest/ingest.module';
import { LiveModule } from './live/live.module';
import { ManagementModule } from './management.module';
import { PrismaModule } from './prisma/prisma.module';

export interface AppModuleOptions {
  config?: AppConfig;
  /** DNS resolver override for the save-time SSRF check, for tests. */
  resolver?: Resolver;
}

@Module({})
export class AppModule {
  static forRoot(options: AppModuleOptions = {}): DynamicModule {
    return {
      module: AppModule,
      global: true,
      imports: [
        ConfigModule.forRoot(options.config),
        PrismaModule,
        LiveModule,
        AuthModule,
        IngestModule,
        ManagementModule,
      ],
      providers: [{ provide: DNS_RESOLVER, useValue: options.resolver }],
      exports: [DNS_RESOLVER],
    };
  }
}
