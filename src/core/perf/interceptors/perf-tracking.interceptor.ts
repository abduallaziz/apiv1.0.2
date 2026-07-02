import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';
import { PerfTrackingService } from '../perf-tracking.service';
import { AsyncContextService } from '../../logger/context/async-context.service';

@Injectable()
export class PerfTrackingInterceptor implements NestInterceptor {
  constructor(
    private readonly perfTracking: PerfTrackingService,
    private readonly asyncContext: AsyncContextService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const start = Date.now();
    const method = request.method;
    const route = (request.route?.path as string | undefined) ?? request.path ?? 'unknown';

    const record = (statusCode: number): void => {
      const durationMs = Date.now() - start;
      const dbQueryCount = this.asyncContext.get()?.dbQueryCount ?? 0;
      // Fire-and-forget — Redis write is async but must never stall the response
      void this.perfTracking.record(method, route, durationMs, dbQueryCount, statusCode);
    };

    return next.handle().pipe(
      tap({
        next: () => record(response.statusCode),
        error: (err: { status?: number }) => record(err?.status ?? 500),
      }),
    );
  }
}
