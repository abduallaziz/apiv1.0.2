import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { CancelInvoiceDto } from './dto/cancel-invoice.dto';
import { HoldOrderDto } from './dto/hold-order.dto';
import { UpdateHeldVisibilityDto } from './dto/update-held-visibility.dto';
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
    const ip = (req.headers['x-forwarded-for'] as string) ?? req.ip ?? '';
    const device = (req.headers['user-agent'] as string) ?? '';

    return this.invoicesService.create(
      tenant,
      dto,
      user.sub,
      user.role,
      dto.branch_id,
      dto.shift_id,
      ip,
      device,
    );
  }

  @Get()
  @RequirePermission('invoice.view')
  async findAll(
    @GetTenant() tenant: TenantContext,
    @Query('branch_id') branchId?: string,
    @Query('date_from') dateFrom?: string,
    @Query('date_to') dateTo?: string,
    @Query('page') page?: string,
    @Query('per_page') perPage?: string,
    @Query('status') status?: string,
  ) {
    return this.invoicesService.findAll(tenant, branchId, dateFrom, dateTo, page, perPage, status);
  }

  // Registered before ':id' — otherwise Nest would route
  // GET /invoices/held (and its sub-paths) into the :id handler instead,
  // same gotcha already documented elsewhere in this codebase (e.g.
  // item-barcodes' lookup/:barcode vs :id).
  @Post('held')
  @RequirePermission('invoice.create')
  async holdOrder(
    @Body() dto: HoldOrderDto,
    @GetTenant() tenant: TenantContext,
    @Req() req: Request,
  ) {
    const user = req.user as { sub: string; role: string };
    return this.invoicesService.holdOrder(tenant, dto, user.sub, user.role);
  }

  @Get('held')
  @RequirePermission('invoice.view')
  async listHeldOrders(
    @GetTenant() tenant: TenantContext,
    @Query('branch_id') branchId: string,
    @Req() req: Request,
  ) {
    const user = req.user as { sub: string; role: string };
    return this.invoicesService.listHeldOrders(tenant, branchId, user.sub);
  }

  @Get('held/:id')
  @RequirePermission('invoice.view')
  async getHeldOrder(
    @Param('id') id: string,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.invoicesService.getHeldOrder(tenant, id);
  }

  @Patch('held/:id/visibility')
  @RequirePermission('invoice.create')
  async updateHeldVisibility(
    @Param('id') id: string,
    @Body() dto: UpdateHeldVisibilityDto,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.invoicesService.updateHeldVisibility(tenant, id, dto.held_visibility);
  }

  @Delete('held/:id')
  @RequirePermission('invoice.cancel')
  async cancelHeldOrder(
    @Param('id') id: string,
    @GetTenant() tenant: TenantContext,
    @Req() req: Request,
  ) {
    const user = req.user as { sub: string; role: string };
    return this.invoicesService.cancelHeldOrder(tenant, id, user.sub, user.role);
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