import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditService } from './audit.service';
import { AUDIT_KEY } from './audit.decorator';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly auditService: AuditService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const action = this.reflector.getAllAndOverride<string>(AUDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!action) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const tenantContext = request.tenantContext;

    const ip =
      (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
      request.ip ??
      'unknown';

    const device =
      (request.headers['user-agent'] as string) ?? 'unknown';

    const [resource_type] = action.split('.');

    return next.handle().pipe(
      tap((responseData: unknown) => {
        if (!user) return;

        this.auditService
          .log({
            tenant_id: tenantContext?.tenantId ?? null,
            actor_id: user.sub,
            actor_role: user.role,
            action,
            resource_type,
            resource_id: this.extractResourceId(request, responseData),
            after_data: this.safeExtract(responseData),
            ip_address: ip,
            device,
          })
          .catch((err: Error) =>
            this.logger.error(`Audit log write failed: ${err.message}`),
          );
      }),
    );
  }

  private extractResourceId(
    request: Record<string, unknown>,
    responseData: unknown,
  ): string | undefined {
    const params = request.params as Record<string, string> | undefined;
    if (params?.id) return params.id;

    const data = responseData as Record<string, unknown> | null;
    if (data && typeof data === 'object' && 'id' in data) {
      return String(data.id);
    }

    return undefined;
  }

  private safeExtract(data: unknown): Record<string, unknown> | undefined {
    if (!data || typeof data !== 'object') return undefined;
    try {
      return JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }
}