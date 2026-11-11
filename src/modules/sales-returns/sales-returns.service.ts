import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TenantContext } from '../../core/tenant/tenant.context';
import { AuditService } from '../../core/audit/audit.service';
import { RedisCacheService } from '../../core/cache/redis-cache.service';
import {
  SalesReturnResult,
  SalesReturnsRepository,
} from './sales-returns.repository';
import { CreateSalesReturnDto } from './dto/create-sales-return.dto';

// Postgres RAISE EXCEPTION from fn_create_sales_return surfaces as code
// P0001: those are business-rule rejections (quantity > remaining, no open
// register for a cash refund, order not completed, closed fiscal period ...)
// and are returned to the client as 400 with the database message.
function toBadRequest(err: unknown): never {
  const e = err as { code?: string; message?: string };
  if (e?.code === 'P0001' && e.message) {
    throw new BadRequestException(e.message);
  }
  throw err;
}

@Injectable()
export class SalesReturnsService {
  constructor(
    private readonly repo: SalesReturnsRepository,
    private readonly audit: AuditService,
    private readonly cache: RedisCacheService,
  ) {}

  async getForOrder(tenant: TenantContext, orderId: string) {
    const info = await this.repo.getOrderReturnInfo(tenant.tenantId, orderId);
    if (!info) throw new NotFoundException('Invoice not found');
    return info;
  }

  private async run(
    tenant: TenantContext,
    orderId: string,
    dto: CreateSalesReturnDto,
    actorId: string,
    dryRun: boolean,
  ): Promise<SalesReturnResult> {
    // A cash refund is paid from the CURRENT open register of the person
    // processing the return (owner decision 2026-11-09); the database
    // function rejects a cash refund when this is null.
    const shiftId = await this.repo.findOpenShiftId(tenant.tenantId, actorId);
    try {
      return await this.repo.callCreate({
        tenantId: tenant.tenantId,
        orderId,
        actorId,
        shiftId,
        reason: dto.reason ?? null,
        items: dto.items.map((i) => ({
          order_item_id: i.order_item_id,
          quantity: i.quantity,
        })),
        dryRun,
      });
    } catch (err) {
      return toBadRequest(err);
    }
  }

  preview(
    tenant: TenantContext,
    orderId: string,
    dto: CreateSalesReturnDto,
    actorId: string,
  ) {
    return this.run(tenant, orderId, dto, actorId, true);
  }

  async create(
    tenant: TenantContext,
    orderId: string,
    dto: CreateSalesReturnDto,
    actorId: string,
    actorRole: string,
    ip: string,
    device: string,
  ) {
    const result = await this.run(tenant, orderId, dto, actorId, false);

    await this.audit.log({
      tenant_id: tenant.tenantId,
      actor_id: actorId,
      actor_role: actorRole,
      action: 'invoice.return',
      resource_type: 'invoice',
      resource_id: orderId,
      after_data: {
        return_id: result.id,
        refund_total: result.refund_total,
        refund_cash: result.refund_cash,
        refund_noncash: result.refund_noncash,
        reason: dto.reason ?? null,
        lines: result.lines,
      },
      ip_address: ip,
      device,
    });

    await this.cache.delByPrefix(`invoices:list:tenant:${tenant.tenantId}:`);
    return result;
  }
}
