import { Injectable } from '@nestjs/common';
import { WmsDashboardRepository } from './repositories/wms-dashboard.repository';

// Inventory #7 / 7-8 (Owner-approved) — Operational Visibility. Pure
// read-through service, no mutation, no audit logging (nothing here
// changes state) — matches AnalyticsService/AdvancedAnalyticsService
// convention for report-style services.
@Injectable()
export class WmsDashboardService {
  constructor(private readonly repo: WmsDashboardRepository) {}

  async overview(tenantId: string, warehouseId?: string) {
    const [tasks, pickLists, waves, shipments, exceptions, reservations] =
      await Promise.all([
        this.repo.taskOverview(tenantId, warehouseId),
        this.repo.pickListOverview(tenantId, warehouseId),
        this.repo.waveOverview(tenantId, warehouseId),
        this.repo.shipmentOverview(tenantId, warehouseId),
        this.repo.exceptionOverview(tenantId, warehouseId),
        this.repo.reservationOverview(tenantId, warehouseId),
      ]);
    return { tasks, pickLists, waves, shipments, exceptions, reservations };
  }

  taskOverview(tenantId: string, warehouseId?: string) {
    return this.repo.taskOverview(tenantId, warehouseId);
  }

  pickListOverview(tenantId: string, warehouseId?: string) {
    return this.repo.pickListOverview(tenantId, warehouseId);
  }

  waveOverview(tenantId: string, warehouseId?: string) {
    return this.repo.waveOverview(tenantId, warehouseId);
  }

  shipmentOverview(tenantId: string, warehouseId?: string) {
    return this.repo.shipmentOverview(tenantId, warehouseId);
  }

  exceptionOverview(
    tenantId: string,
    warehouseId?: string,
    dateFrom?: string,
    dateTo?: string,
  ) {
    return this.repo.exceptionOverview(tenantId, warehouseId, dateFrom, dateTo);
  }

  reservationOverview(tenantId: string, warehouseId?: string) {
    return this.repo.reservationOverview(tenantId, warehouseId);
  }

  waveShipmentSummary(waveId: string, tenantId: string) {
    return this.repo.waveShipmentSummary(waveId, tenantId);
  }

  cycleTimeOverview(
    tenantId: string,
    entityType: 'warehouse_task' | 'pick_list' | 'wave',
    warehouseId?: string,
  ) {
    return this.repo.cycleTimeOverview(tenantId, entityType, warehouseId);
  }

  listExceptionsDrillDown(
    tenantId: string,
    filters: {
      warehouseId?: string;
      exceptionType?: string;
      entityType?: string;
      dateFrom?: string;
      dateTo?: string;
      page?: number;
      limit?: number;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
    },
  ) {
    return this.repo.listExceptionsDrillDown(tenantId, filters);
  }
}
