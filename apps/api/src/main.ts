import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { loadAppConfig } from './config/app-config';

async function bootstrap(): Promise<void> {
  const config = loadAppConfig();
  const app = await NestFactory.create(AppModule.forRoot(config), { bodyParser: false });
  configureApp(app);
  await app.listen(config.port);
  Logger.log(`Hookline API listening on port ${config.port}`, 'Bootstrap');
}

void bootstrap();
