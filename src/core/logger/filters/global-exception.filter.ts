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

    const err = exception instanceof Error ? exception : new Error(String(exception));

    if (status >= 500) {
      this.logger.error('Unhandled Exception', err, {
        module: 'exception_filter',
        action: 'unhandled_exception',
        meta: {
          method: request.method,
          path: request.path,
          statusCode: status,
          errorName: err.name,
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
}