import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { SalesReturnsService } from './sales-returns.service';
import { CreateSalesReturnDto } from './dto/create-sales-return.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant-context';

// Returns reuse the existing invoice.cancel permission (the people who may
// cancel an invoice may return part of it); no new permission to seed.
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('invoices/:id/returns')
export class SalesReturnsController {
  constructor(private readonly service: SalesReturnsService) {}

  @Get()
  @RequirePermission('invoice.view')
  getForOrder(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.service.getForOrder(tenant, id);
  }

  @Post('preview')
  @RequirePermission('invoice.cancel')
  preview(
    @Param('id') id: string,
    @Body() dto: CreateSalesReturnDto,
    @GetTenant() tenant: TenantContext,
    @Req() req: Request,
  ) {
    const user = req.user as { sub: string };
    return this.service.preview(tenant, id, dto, user.sub);
  }

  @Post()
  @RequirePermission('invoice.cancel')
  create(
    @Param('id') id: string,
    @Body() dto: CreateSalesReturnDto,
    @GetTenant() tenant: TenantContext,
    @Req() req: Request,
  ) {
    const user = req.user as { sub: string; role: string };
    const ip = (req.headers['x-forwarded-for'] as string) ?? req.ip ?? '';
    const device = req.headers['user-agent'] ?? '';
    return this.service.create(tenant, id, dto, user.sub, user.role, ip, device);
  }
}
