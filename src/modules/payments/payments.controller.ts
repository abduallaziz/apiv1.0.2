import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { PaymentsService } from './payments.service';
import { QueryPaymentsDto } from './dto/query-payments.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';

@Controller('payments')
@UseGuards(JwtAuthGuard, TenantGuard)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  private resolveTenant(tenant: TenantContext | undefined, req: Request): TenantContext {
    if (tenant) return tenant;
    const user = req.user as { tenant_id: string };
    return { tenantId: user.tenant_id } as TenantContext;
  }

  @Get()
  getPaymentHistory(
    @GetTenant() tenant: TenantContext,
    @Query() dto: QueryPaymentsDto,
    @Req() req: Request,
  ) {
    return this.paymentsService.getPaymentHistory(this.resolveTenant(tenant, req), dto);
  }

  @Get('invoices')
  getInvoices(
    @GetTenant() tenant: TenantContext,
    @Query() dto: QueryPaymentsDto,
    @Req() req: Request,
  ) {
    return this.paymentsService.getInvoices(this.resolveTenant(tenant, req), dto);
  }

  @Get('invoices/:id')
  getInvoiceDetail(
    @GetTenant() tenant: TenantContext,
    @Param('id') invoiceId: string,
    @Req() req: Request,
  ) {
    return this.paymentsService.getInvoiceDetail(this.resolveTenant(tenant, req), invoiceId);
  }

  @Get('invoices/:id/payments')
  getInvoicePayments(
    @GetTenant() tenant: TenantContext,
    @Param('id') invoiceId: string,
    @Req() req: Request,
  ) {
    return this.paymentsService.getInvoicePayments(this.resolveTenant(tenant, req), invoiceId);
  }
}