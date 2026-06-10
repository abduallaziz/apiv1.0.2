import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import * as express from 'express';
import { AppModule } from './app.module';
import { LoggerService } from './core/logger/logger.service';
import { LoggingInterceptor } from './core/logger/interceptors/logging.interceptor';
import { GlobalExceptionFilter } from './core/logger/filters/global-exception.filter';
import { MetricsInterceptor } from './core/metrics/interceptors/metrics.interceptor';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    bufferLogs: true,
  });

  app.use(helmet());

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
  const loggingInterceptor = app.get(LoggingInterceptor);
  const exceptionFilter = app.get(GlobalExceptionFilter);
  const metricsInterceptor = app.get(MetricsInterceptor);

  app.useGlobalInterceptors(loggingInterceptor, metricsInterceptor);
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