import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { CancelInvoiceDto } from './dto/cancel-invoice.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant-context';
import { Request } from 'express';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Post()
  @RequirePermission('invoice.create')
  async create(
    @Body() dto: CreateInvoiceDto,
    @GetTenant() tenant: TenantContext,
    @Req() req: Request,
  ) {
    const user = req.user as { sub: string; role: string };
    const branchId = req.headers['x-branch-id'] as string;
    const shiftId = req.headers['x-shift-id'] as string;
    const ip = (req.headers['x-forwarded-for'] as string) ?? req.ip ?? '';
    const device = (req.headers['user-agent'] as string) ?? '';

    return this.invoicesService.create(
      tenant,
      dto,
      user.sub,
      user.role,
      branchId,
      shiftId,
      ip,
      device,
    );
  }

  @Get()
  @RequirePermission('invoice.view')
  async findAll(
    @GetTenant() tenant: TenantContext,
    @Query('branch_id') branchId?: string,
  ) {
    return this.invoicesService.findAll(tenant, branchId);
  }

  @Get(':id')
  @RequirePermission('invoice.view')
  async findById(
    @Param('id') id: string,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.invoicesService.findById(tenant, id);
  }

  @Patch(':id/cancel')
  @RequirePermission('invoice.cancel')
  async cancel(
    @Param('id') id: string,
    @Body() dto: CancelInvoiceDto,
    @GetTenant() tenant: TenantContext,
    @Req() req: Request,
  ) {
    const user = req.user as { sub: string; role: string };
    const ip = (req.headers['x-forwarded-for'] as string) ?? req.ip ?? '';
    const device = (req.headers['user-agent'] as string) ?? '';

    return this.invoicesService.cancel(tenant, id, dto, user.sub, user.role, ip, device);
  }
}