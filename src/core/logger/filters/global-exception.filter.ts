import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { LoggerService } from '../logger.service';

interface JwtUser {
  sub?: string;
  tenant_id?: string;
  role?: string;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: LoggerService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const message = isHttpException
      ? (exception.getResponse() as string | { message: string })
      : 'Internal server error';

    const errorMessage =
      typeof message === 'string' ? message : message.message ?? 'Unknown error';

    // Some exceptions (e.g. LEAVE_BALANCE_EXCEEDED) throw a structured body with
    // extra machine-readable fields beyond `message` — pass those through as-is so
    // clients can branch on them, without changing the response shape for every
    // other exception in the app (which only ever had these four fields).
    const extraFields =
      typeof message === 'object' && message !== null && !Array.isArray(message)
        ? Object.fromEntries(
            Object.entries(message).filter(([key]) => !['statusCode', 'message', 'timestamp', 'path'].includes(key)),
          )
        : {};

    const err = this.toError(exception);

    // Extract user context directly from the request so it is always
    // available even when exceptions originate from guards (which run before
    // interceptors and therefore before AsyncLocalStorage context is set).
    const user = (request.user as JwtUser | undefined);
    const userContext = {
      tenantId: user?.tenant_id ?? 'unknown',
      userId: user?.sub ?? 'anonymous',
      role: user?.role ?? 'unknown',
    };

    const routeMeta = {
      method: request.method,
      route: (request.route?.path as string | undefined) ?? request.path,
      path: request.path,
    };

    if (status >= 500) {
      this.logger.error('Unhandled Exception', err, {
        module: 'exception_filter',
        action: 'unhandled_exception',
        ...userContext,
        meta: {
          ...routeMeta,
          statusCode: status,
          errorName: err.name,
          ...this.extractPostgrestDetails(exception),
        },
      });
    } else if (status >= 400) {
      this.logger.warn('Client Error', {
        module: 'exception_filter',
        action: 'client_error',
        ...userContext,
        meta: {
          ...routeMeta,
          statusCode: status,
          errorName: err.name,
          errorMessage,
        },
      });
    }

    response.status(status).json({
      statusCode: status,
      message: errorMessage,
      timestamp: new Date().toISOString(),
      path: request.path,
      ...extraFields,
    });
  }

  // Supabase/Postgrest errors are plain objects ({message, code, details, hint}),
  // not Error instances — String(exception) on those yields "[object Object]" and
  // silently destroys the actual DB error message before it reaches the logger.
  private toError(exception: unknown): Error {
    if (exception instanceof Error) return exception;

    if (
      typeof exception === 'object' &&
      exception !== null &&
      'message' in exception &&
      typeof (exception as { message: unknown }).message === 'string'
    ) {
      return new Error((exception as { message: string }).message);
    }

    return new Error(JSON.stringify(exception) ?? String(exception));
  }

  private extractPostgrestDetails(exception: unknown): Record<string, unknown> {
    if (typeof exception !== 'object' || exception === null) return {};

    const { code, details, hint } = exception as {
      code?: string;
      details?: string;
      hint?: string;
    };

    const out: Record<string, unknown> = {};
    if (code) out.dbErrorCode = code;
    if (details) out.dbErrorDetails = details;
    if (hint) out.dbErrorHint = hint;
    return out;
  }
}