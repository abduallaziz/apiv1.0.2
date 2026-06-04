import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, tap, catchError, throwError } from 'rxjs';
import { Request, Response } from 'express';
import { AsyncContextService } from '../context/async-context.service';
import { LoggerService } from '../logger.service';
import { createRequestContext } from '../context/logger.context';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(
    private readonly asyncContext: AsyncContextService,
    private readonly logger: LoggerService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    const user = (req as Request & { user?: { sub?: string; role?: string; tenantId?: string } }).user;

    const requestContext = createRequestContext({
      correlationId: req.headers['x-correlation-id'] as string | undefined,
      tenantId: user?.tenantId,
      userId: user?.sub,
      role: user?.role,
    });

    // Inject requestId into response headers
    res.setHeader('x-request-id', requestContext.requestId);

    return new Observable((subscriber) => {
      this.asyncContext.run(requestContext, () => {
        const startTime = Date.now();

        this.logger.info('HTTP Request Started', {
          module: 'http',
          action: 'request_start',
          meta: {
            method: req.method,
            path: req.path,
            ip: req.ip,
          },
        });

        next
          .handle()
          .pipe(
            tap(() => {
              const durationMs = Date.now() - startTime;
              this.logger.info('HTTP Request Completed', {
                module: 'http',
                action: 'request_end',
                meta: {
                  method: req.method,
                  path: req.path,
                  statusCode: res.statusCode,
                  durationMs,
                },
              });
            }),
            catchError((error: unknown) => {
              const durationMs = Date.now() - startTime;
              const err = error instanceof Error ? error : new Error(String(error));
              this.logger.error('HTTP Request Failed', err, {
                module: 'http',
                action: 'request_error',
                meta: {
                  method: req.method,
                  path: req.path,
                  statusCode: res.statusCode,
                  durationMs,
                },
              });
              return throwError(() => error);
            }),
          )
          .subscribe(subscriber);
      });
    });
  }
}