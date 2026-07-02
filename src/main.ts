import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import * as express from 'express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { LoggerService } from './core/logger/logger.service';
import { LoggingInterceptor } from './core/logger/interceptors/logging.interceptor';
import { GlobalExceptionFilter } from './core/logger/filters/global-exception.filter';
import { MetricsInterceptor } from './core/metrics/interceptors/metrics.interceptor';
import { PerfTrackingInterceptor } from './core/perf/interceptors/perf-tracking.interceptor';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    bufferLogs: true,
  });

  app.use(helmet());
  app.use(cookieParser());

  // API responses carry private, tenant-scoped data behind JWT auth — must never be
  // cached or conditionally revalidated by browsers/CDNs (etag/304 caused empty-body
  // 304 responses to surface as fetch errors, and `Cache-Control: public` without
  // `Vary: Authorization` risked a shared cache serving one tenant's data to another).
  app.getHttpAdapter().getInstance().set('etag', false);
  app.use((_req: express.Request, res: express.Response, next: express.NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.use(
    '/api/v1/webhooks/stripe',
    express.raw({ type: 'application/json' }),
  );

  app.enableCors({
    origin: [
      'http://localhost:3000',
      'https://sefayv1-0-2.vercel.app',
      process.env.FRONTEND_URL ?? '',
    ].filter(Boolean),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-branch-id',
      'x-tenant-id',
      'x-correlation-id',
    ],
  });

  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const loggerService = app.get(LoggerService);

  // Capture process-level errors that escape all NestJS exception handling
  // (e.g. errors in background jobs, non-HTTP async callbacks).
  // These log only — the process continues running to avoid dropping live requests.
  process.on('uncaughtException', (error: Error) => {
    loggerService.error('Uncaught Exception', error, {
      module: 'process',
      action: 'uncaught_exception',
    });
  });

  process.on('unhandledRejection', (reason: unknown) => {
    const error =
      reason instanceof Error
        ? reason
        : new Error(typeof reason === 'string' ? reason : JSON.stringify(reason));
    loggerService.error('Unhandled Promise Rejection', error, {
      module: 'process',
      action: 'unhandled_rejection',
    });
  });

  const loggingInterceptor = app.get(LoggingInterceptor);
  const exceptionFilter = app.get(GlobalExceptionFilter);
  const metricsInterceptor = app.get(MetricsInterceptor);
  const perfTrackingInterceptor = app.get(PerfTrackingInterceptor);

  // PerfTrackingInterceptor must run after LoggingInterceptor so the
  // AsyncLocalStorage request context (and its dbQueryCount counter) exists.
  app.useGlobalInterceptors(loggingInterceptor, metricsInterceptor, perfTrackingInterceptor);
  app.useGlobalFilters(exceptionFilter);

  const port = process.env.PORT ?? 3001;
  await app.listen(port);

  loggerService.info('Application started', {
    module: 'bootstrap',
    action: 'app_start',
    meta: { port },
  });
}

bootstrap();