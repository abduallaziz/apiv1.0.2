export interface LogContext {
  module?: string;
  action?: string;
  tenantId?: string;
  userId?: string;
  requestId?: string;
  correlationId?: string;
  meta?: Record<string, unknown>;
}

export interface RequestLogContext {
  requestId: string;
  correlationId: string;
  tenantId: string;
  userId: string;
  role: string;
  dbQueryCount: number;
}

export interface ILoggerService {
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, error?: Error, context?: LogContext): void;
  debug(message: string, context?: LogContext): void;
}