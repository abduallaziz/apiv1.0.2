import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ProductionOrdersService } from './production-orders.service';
import { CreateProductionOrderDto } from './dto/create-production-order.dto';
import { UpdateProductionOrderDto } from './dto/update-production-order.dto';
import { CompleteProductionOrderDto } from './dto/complete-production-order.dto';
import { QueryProductionOrdersDto } from './dto/query-production-orders.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtPayload } from '../../shared/types/jwt-payload.type';
import { Audit } from '../../core/audit/audit.decorator';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('manufacturing/production-orders')
export class ProductionOrdersController {
  constructor(private readonly productionOrdersService: ProductionOrdersService) {}

  @Get()
  @RequirePermission('manufacturing.view')
  findAll(@GetTenant() tenant: TenantContext, @Query() query: QueryProductionOrdersDto) {
    return this.productionOrdersService.findAll(tenant.tenantId, query);
  }

  @Get(':id')
  @RequirePermission('manufacturing.view')
  findOne(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.productionOrdersService.getDetails(id, tenant.tenantId);
  }

  @Post()
  @RequirePermission('manufacturing.plan')
  @Audit('production_order.created')
  create(@Body() dto: CreateProductionOrderDto, @GetTenant() tenant: TenantContext) {
    return this.productionOrdersService.create(tenant.tenantId, dto);
  }

  @Patch(':id')
  @RequirePermission('manufacturing.plan')
  @Audit('production_order.updated')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateProductionOrderDto,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.productionOrdersService.update(id, tenant.tenantId, dto);
  }

  @Post(':id/start')
  @RequirePermission('manufacturing.execute')
  @HttpCode(HttpStatus.OK)
  @Audit('production_order.started')
  start(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.productionOrdersService.start(id, tenant.tenantId);
  }

  @Post(':id/complete')
  @RequirePermission('manufacturing.execute')
  @HttpCode(HttpStatus.OK)
  complete(
    @Param('id') id: string,
    @Body() dto: CompleteProductionOrderDto,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.productionOrdersService.complete(id, tenant.tenantId, user.sub, dto);
  }

  @Post(':id/cancel')
  @RequirePermission('manufacturing.execute')
  @HttpCode(HttpStatus.OK)
  @Audit('production_order.cancelled')
  cancel(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.productionOrdersService.cancel(id, tenant.tenantId);
  }
}
