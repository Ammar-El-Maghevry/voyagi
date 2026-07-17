import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import type { AppConfig } from './config';
import { configureApp } from './bootstrap/configure-app';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  configureApp(app);

  const appConfig = app.get(ConfigService).getOrThrow<AppConfig>('app');
  await app.listen(appConfig.port);

  app
    .get(Logger)
    .log(
      `Voyagi API listening on port ${appConfig.port} [${appConfig.nodeEnv}]`,
      'Bootstrap',
    );
}

void bootstrap();
