import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { SubcontractOrdersService } from './subcontract-orders.service';
import { CreateSubcontractOrderDto } from './dto/create-subcontract-order.dto';
import { CreateSubcontractCostDto } from './dto/create-subcontract-cost.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtPayload } from '../../shared/types/jwt-payload.type';
import { Audit } from '../../core/audit/audit.decorator';

// Migration 13.16C (#16, Manufacturing — Subcontracting). Reuses
// manufacturing.manage (planning-type actions: create, add cost) and
// manufacturing.execute (execution-time actions: send, receive) exactly
// as Routing/Scrap/By-products already established — no new permission.
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('manufacturing/subcontract-orders')
export class SubcontractOrdersController {
  constructor(
    private readonly subcontractOrdersService: SubcontractOrdersService,
  ) {}

  @Get()
  @RequirePermission('manufacturing.view')
  findAll(
    @GetTenant() tenant: TenantContext,
    @Query('status') status?: string,
  ) {
    return this.subcontractOrdersService.findAll(tenant.tenantId, status);
  }

  @Get(':id')
  @RequirePermission('manufacturing.view')
  findOne(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.subcontractOrdersService.findById(id, tenant.tenantId);
  }

  @Post()
  @RequirePermission('manufacturing.manage')
  @Audit('subcontract_order.created')
  create(
    @Body() dto: CreateSubcontractOrderDto,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.subcontractOrdersService.create(tenant.tenantId, user.sub, dto);
  }

  @Post(':id/send')
  @RequirePermission('manufacturing.execute')
  @HttpCode(HttpStatus.OK)
  @Audit('subcontract_order.sent')
  send(
    @Param('id') id: string,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.subcontractOrdersService.send(id, tenant.tenantId, user.sub);
  }

  @Post(':id/receive')
  @RequirePermission('manufacturing.execute')
  @HttpCode(HttpStatus.OK)
  @Audit('subcontract_order.received')
  receive(
    @Param('id') id: string,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.subcontractOrdersService.receive(id, tenant.tenantId, user.sub);
  }

  @Get(':id/costs')
  @RequirePermission('manufacturing.view')
  findCosts(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.subcontractOrdersService.findCosts(id, tenant.tenantId);
  }

  @Post(':id/costs')
  @RequirePermission('manufacturing.manage')
  @Audit('subcontract_order.cost_added')
  addCost(
    @Param('id') id: string,
    @Body() dto: CreateSubcontractCostDto,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.subcontractOrdersService.addCost(
      id,
      tenant.tenantId,
      user.sub,
      dto,
    );
  }
}
