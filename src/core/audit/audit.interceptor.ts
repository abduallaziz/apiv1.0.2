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

    const device = (request.headers['user-agent'] as string) ?? 'unknown';

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
            // Branch System Step 5/6 (Owner-approved): every @Audit()-decorated
            // action whose resource has a real, directly-resolvable branch
            // was converted to an explicit manual AuditService.log() call in
            // its own service (which knows its exact branch source — a
            // direct column, or a resolved warehouse_id -> warehouses.branch_id
            // lookup — with certainty, not response-shape guessing). That now
            // includes work_center.created/updated, goods_receipt.created/
            // posted/cancelled, location.create/update/delete,
            // replenishment_rule.created, putaway_rule.created, and
            // warehouse_task.created/assigned/confirmed.
            //
            // Every action still routed through this interceptor is
            // therefore, by construction, one of:
            //   (a) genuinely tenant-wide (auth, user/role/permission admin,
            //       superadmin, subscriptions, payroll, leave, HR/attendance
            //       administration, BOM/quality-rule/template/plan
            //       definitions not tied to one warehouse), or
            //   (b) a resource that spans multiple warehouses/branches in a
            //       single record by design (e.g. inventory_snapshot.generated
            //       — one run aggregates cost layers across every warehouse,
            //       so no single branch_id is correct).
            // This always logs null, and deliberately never falls back to
            // the actor's own branch_id (that would misattribute a
            // tenant-wide/multi-branch action to wherever the actor happens
            // to work).
            branch_id: null,
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
