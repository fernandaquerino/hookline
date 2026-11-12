import { type DynamicModule, Global, Module } from '@nestjs/common';
import {
  DISPATCHER_CONFIG,
  type DispatcherConfig,
  loadDispatcherConfig,
} from './dispatcher-config';

@Global()
@Module({})
export class ConfigModule {
  static forRoot(config?: DispatcherConfig): DynamicModule {
    return {
      module: ConfigModule,
      providers: [
        { provide: DISPATCHER_CONFIG, useFactory: () => config ?? loadDispatcherConfig() },
      ],
      exports: [DISPATCHER_CONFIG],
    };
  }
}
