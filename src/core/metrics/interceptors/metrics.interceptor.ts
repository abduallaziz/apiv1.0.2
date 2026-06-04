import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';
import { MetricsService } from '../metrics.service';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metricsService: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    // Skip the /metrics endpoint itself
    if (request.path === '/api/v1/metrics') {
      return next.handle();
    }

    const start = Date.now();
    const method = request.method;
    // Normalize route: use matched route pattern, not raw URL (avoids high cardinality)
    const route = (request.route?.path as string) ?? request.path ?? 'unknown';

    this.metricsService.httpActiveRequests.inc();

    return next.handle().pipe(
      tap({
        next: () => {
          const statusCode = String(response.statusCode);
          const duration = Date.now() - start;

          this.metricsService.httpRequestDuration.observe(
            { method, route, status_code: statusCode },
            duration,
          );
          this.metricsService.httpRequestsTotal.inc({
            method,
            route,
            status_code: statusCode,
          });
          this.metricsService.httpActiveRequests.dec();
        },
        error: (err: { status?: number }) => {
          const statusCode = String(err?.status ?? 500);
          const duration = Date.now() - start;

          this.metricsService.httpRequestDuration.observe(
            { method, route, status_code: statusCode },
            duration,
          );
          this.metricsService.httpRequestsTotal.inc({
            method,
            route,
            status_code: statusCode,
          });
          this.metricsService.httpActiveRequests.dec();
        },
      }),
    );
  }
}