import {
  Controller,
  Get,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { WmsDashboardService } from './wms-dashboard.service';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';
import { DashboardExceptionsDrillDownQueryDto } from './dto/wms-list-query.dto';

// Inventory #7 / 7-8 (Owner-approved) — Operational Visibility / Aggregate
// Queries. Pure read layer over the WMS execution state built in 7-1
// through 7-7 (migration 244). No mutation endpoints here.
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('inventory/wms/dashboard')
export class WmsDashboardController {
  constructor(private readonly service: WmsDashboardService) {}

  @Get('overview')
  @RequirePermission('inventory.view')
  overview(
    @GetTenant() tenant: TenantContext,
    @Query('warehouse_id') warehouseId?: string,
  ) {
    return this.service.overview(tenant.tenantId, warehouseId);
  }

  @Get('tasks')
  @RequirePermission('inventory.view')
  tasks(
    @GetTenant() tenant: TenantContext,
    @Query('warehouse_id') warehouseId?: string,
  ) {
    return this.service.taskOverview(tenant.tenantId, warehouseId);
  }

  @Get('pick-lists')
  @RequirePermission('inventory.view')
  pickLists(
    @GetTenant() tenant: TenantContext,
    @Query('warehouse_id') warehouseId?: string,
  ) {
    return this.service.pickListOverview(tenant.tenantId, warehouseId);
  }

  @Get('waves')
  @RequirePermission('inventory.view')
  waves(
    @GetTenant() tenant: TenantContext,
    @Query('warehouse_id') warehouseId?: string,
  ) {
    return this.service.waveOverview(tenant.tenantId, warehouseId);
  }

  @Get('shipments')
  @RequirePermission('inventory.view')
  shipments(
    @GetTenant() tenant: TenantContext,
    @Query('warehouse_id') warehouseId?: string,
  ) {
    return this.service.shipmentOverview(tenant.tenantId, warehouseId);
  }

  @Get('exceptions')
  @RequirePermission('inventory.view')
  exceptions(
    @GetTenant() tenant: TenantContext,
    @Query('warehouse_id') warehouseId?: string,
    @Query('date_from') dateFrom?: string,
    @Query('date_to') dateTo?: string,
  ) {
    return this.service.exceptionOverview(
      tenant.tenantId,
      warehouseId,
      dateFrom,
      dateTo,
    );
  }

  // Inventory #7 / F17 (Owner-approved) — aligned from offset/limit to
  // the standard page/limit contract used by every other WMS list
  // endpoint. This drill-down had zero real frontend consumers at the
  // time of the change (verified during the F17 audit), so no
  // offset-based caller needed preserving.
  @Get('exceptions/drill-down')
  @RequirePermission('inventory.view')
  exceptionsDrillDown(
    @GetTenant() tenant: TenantContext,
    @Query() query: DashboardExceptionsDrillDownQueryDto,
  ) {
    return this.service.listExceptionsDrillDown(tenant.tenantId, {
      warehouseId: query.warehouse_id,
      exceptionType: query.exception_type,
      entityType: query.entity_type,
      dateFrom: query.date_from,
      dateTo: query.date_to,
      page: query.page,
      limit: query.limit,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    });
  }

  @Get('reservations')
  @RequirePermission('inventory.view')
  reservations(
    @GetTenant() tenant: TenantContext,
    @Query('warehouse_id') warehouseId?: string,
  ) {
    return this.service.reservationOverview(tenant.tenantId, warehouseId);
  }

  @Get('wave-shipment-summary')
  @RequirePermission('inventory.view')
  waveShipmentSummary(
    @Query('wave_id') waveId: string,
    @GetTenant() tenant: TenantContext,
  ) {
    if (!waveId) throw new BadRequestException('wave_id is required');
    return this.service.waveShipmentSummary(waveId, tenant.tenantId);
  }

  @Get('cycle-time')
  @RequirePermission('inventory.view')
  cycleTime(
    @Query('entity_type') entityType: 'warehouse_task' | 'pick_list' | 'wave',
    @GetTenant() tenant: TenantContext,
    @Query('warehouse_id') warehouseId?: string,
  ) {
    if (!entityType) throw new BadRequestException('entity_type is required');
    return this.service.cycleTimeOverview(
      tenant.tenantId,
      entityType,
      warehouseId,
    );
  }
}
