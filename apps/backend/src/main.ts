import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import type { AppConfig } from './config';
import { assertProductionConfig } from './config/production-config.validation';
import { configureApp } from './bootstrap/configure-app';
import { installShutdownWatchdog } from './bootstrap/shutdown-watchdog';

async function bootstrap(): Promise<void> {
  // Fail fast on unsafe production configuration before creating the app (no
  // secret values are included in the error). No-op outside production.
  assertProductionConfig();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    // Expose the raw request body so payment webhook signatures can be verified
    // against the exact bytes the provider signed.
    rawBody: true,
  });

  configureApp(app);

  const appConfig = app.get(ConfigService).getOrThrow<AppConfig>('app');
  const logger = app.get(Logger);

  // Bound graceful shutdown: Nest's shutdown hooks close the pool on
  // SIGTERM/SIGINT; this watchdog force-exits if that overruns the deadline so
  // the process can never hang. It logs only lifecycle metadata (no secrets).
  installShutdownWatchdog(appConfig.shutdownTimeoutMs, {
    onSignal: (signal, handler) => {
      process.on(signal, handler);
    },
    setTimer: (fn, ms) => setTimeout(fn, ms),
    exit: (code) => process.exit(code),
    log: (message) => logger.log(message, 'Shutdown'),
  });

  await app.listen(appConfig.port);

  logger.log(
    `Voyagi API listening on port ${appConfig.port} [${appConfig.nodeEnv}]`,
    'Bootstrap',
  );
}

void bootstrap();
