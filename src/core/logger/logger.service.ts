import { Injectable } from '@nestjs/common';
import * as winston from 'winston';
import { AsyncContextService } from './context/async-context.service';
import { ILoggerService, LogContext } from './logger.interface';
import { createConsoleTransport } from './transports/console.transport';
import { createFileTransports } from './transports/file.transport';
import { SERVICE_NAME } from './logger.constants';

@Injectable()
export class LoggerService implements ILoggerService {
  private readonly winston: winston.Logger;

  constructor(private readonly asyncContext: AsyncContextService) {
    this.winston = winston.createLogger({
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
      transports: [
        createConsoleTransport(),
        ...createFileTransports(),
      ],
    });
  }

  private buildEntry(
    level: string,
    message: string,
    context?: LogContext,
    error?: Error,
  ): Record<string, unknown> {
    const requestContext = this.asyncContext.get();

    const entry: Record<string, unknown> = {
      service: SERVICE_NAME,
      message,
      level,
      tenantId: context?.tenantId ?? requestContext?.tenantId ?? 'system',
      userId: context?.userId ?? requestContext?.userId ?? 'anonymous',
      requestId: context?.requestId ?? requestContext?.requestId,
      correlationId: context?.correlationId ?? requestContext?.correlationId,
    };

    if (context?.module) entry.module = context.module;
    if (context?.action) entry.action = context.action;
    if (context?.meta) entry.meta = context.meta;

    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        // Always logged internally for full error context; never exposed
        // in API responses (GlobalExceptionFilter sends only a generic message).
        stack: error.stack,
      };
    }

    return entry;
  }

  info(message: string, context?: LogContext): void {
    this.winston.info(message, this.buildEntry('info', message, context));
  }

  warn(message: string, context?: LogContext): void {
    this.winston.warn(message, this.buildEntry('warn', message, context));
  }

  error(message: string, error?: Error, context?: LogContext): void {
    this.winston.error(message, this.buildEntry('error', message, context, error));
  }

  debug(message: string, context?: LogContext): void {
    this.winston.debug(message, this.buildEntry('debug', message, context));
  }
}