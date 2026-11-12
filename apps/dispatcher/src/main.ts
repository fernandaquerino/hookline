import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loadDispatcherConfig } from './config/dispatcher-config';
import { DispatcherModule } from './dispatcher.module';

async function bootstrap(): Promise<void> {
  const config = loadDispatcherConfig();
  const app = await NestFactory.createApplicationContext(DispatcherModule.forRoot({ config }));
  app.enableShutdownHooks();
  Logger.log(
    `Hookline dispatcher started (concurrency ${config.workerConcurrency}, private destinations ${
      config.allowPrivateDestinations ? 'allowed' : 'blocked'
    })`,
    'Bootstrap',
  );
}

void bootstrap();
