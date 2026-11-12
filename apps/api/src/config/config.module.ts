import { type DynamicModule, Global, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig, loadAppConfig } from './app-config';

@Global()
@Module({})
export class ConfigModule {
  /** Pass a config to override the environment (used by tests). */
  static forRoot(config?: AppConfig): DynamicModule {
    return {
      module: ConfigModule,
      providers: [{ provide: APP_CONFIG, useFactory: () => config ?? loadAppConfig() }],
      exports: [APP_CONFIG],
    };
  }
}
