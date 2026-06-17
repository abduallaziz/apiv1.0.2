import { Controller, Get, Patch, Param, Body, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';
import { ExpenseTemplatesService } from './expense-templates.service';

class UpdateTemplateDto {
  name?: string;
  default_amount?: number | null;
  requires_photo?: boolean;
  expiry_hours?: number;
  is_active?: boolean;
  is_pre_approved?: boolean;
  recurrence_type?: string;
  recurrence_day?: number | null;
  next_run_at?: string | null;
}

@Controller('expense-templates')
@UseGuards(JwtAuthGuard, TenantGuard)
export class ExpenseTemplatesController {
  constructor(private readonly service: ExpenseTemplatesService) {}

  @Get()
  findAll(@GetTenant() tenant: TenantContext, @Request() req: any) {
    const tenantId = tenant?.tenantId ?? req.user.tenant_id;
    return this.service.findAll(tenantId);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTemplateDto,
    @GetTenant() tenant: TenantContext,
    @Request() req: any,
  ) {
    const tenantId = tenant?.tenantId ?? req.user.tenant_id;
    return this.service.update(id, tenantId, dto);
  }
}