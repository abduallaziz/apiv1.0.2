import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { PurchaseOrdersService } from './purchase-orders.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtPayload } from '../../shared/types/jwt-payload.type';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('purchasing/purchase-orders')
export class PurchaseOrdersController {
  constructor(private readonly purchaseOrdersService: PurchaseOrdersService) {}

  @Get()
  @RequirePermission('purchasing.view')
  findAll(
    @Query('status') status: string,
    @GetTenant() tenant: TenantContext,
    @Query('page') page?: string,
    @Query('per_page') perPage?: string,
  ) {
    return this.purchaseOrdersService.findAll(tenant.tenantId, status, page, perPage);
  }

  @Get(':id')
  @RequirePermission('purchasing.view')
  findOne(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.purchaseOrdersService.findById(id, tenant.tenantId);
  }

  @Post()
  @RequirePermission('purchasing.manage')
  create(
    @Body() dto: CreatePurchaseOrderDto,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.purchaseOrdersService.create(tenant.tenantId, dto, user.sub);
  }

  @Patch(':id')
  @RequirePermission('purchasing.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePurchaseOrderDto,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.purchaseOrdersService.update(id, tenant.tenantId, dto);
  }

  @Post(':id/submit')
  @RequirePermission('purchasing.manage')
  @HttpCode(HttpStatus.OK)
  submit(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.purchaseOrdersService.submit(id, tenant.tenantId);
  }

  @Post(':id/approve')
  @RequirePermission('purchasing.approve')
  @HttpCode(HttpStatus.OK)
  approve(
    @Param('id') id: string,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.purchaseOrdersService.approve(id, tenant.tenantId, user.sub);
  }

  @Post(':id/cancel')
  @RequirePermission('purchasing.manage')
  @HttpCode(HttpStatus.OK)
  cancel(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.purchaseOrdersService.cancel(id, tenant.tenantId);
  }

  @Delete(':id')
  @RequirePermission('purchasing.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.purchaseOrdersService.remove(id, tenant.tenantId);
  }
}
