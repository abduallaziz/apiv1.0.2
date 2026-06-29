import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { LoggerService } from '../logger.service';

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

    const err = this.toError(exception);

    if (status >= 500) {
      this.logger.error('Unhandled Exception', err, {
        module: 'exception_filter',
        action: 'unhandled_exception',
        meta: {
          method: request.method,
          path: request.path,
          statusCode: status,
          errorName: err.name,
          ...this.extractPostgrestDetails(exception),
        },
      });
    } else if (status >= 400) {
      this.logger.warn('Client Error', {
        module: 'exception_filter',
        action: 'client_error',
        meta: {
          method: request.method,
          path: request.path,
          statusCode: status,
          errorMessage,
        },
      });
    }

    response.status(status).json({
      statusCode: status,
      message: errorMessage,
      timestamp: new Date().toISOString(),
      path: request.path,
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