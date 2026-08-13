import { Module } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import {
  SupabaseModule,
  SUPABASE_CLIENT,
} from '../../shared/supabase/supabase.module';
import { TenantSessionService } from '../../core/tenant/tenant-session.service';
import { PermissionsModule } from '../../core/permissions/permissions.module';
import { ApprovalEngineModule } from '../../engines/approval-engine/approval-engine.module';
import { ItemsModule } from '../items/items.module';

import { WarehousesController } from './warehouses.controller';
import { WarehousesService } from './warehouses.service';
import { WarehousesRepository } from './repositories/warehouses.repository';

import { LocationsController } from './locations.controller';
import { LocationsService } from './locations.service';
import { LocationsRepository } from './repositories/locations.repository';

import { ReorderPointsController } from './reorder-points.controller';
import { ReorderPointsService } from './reorder-points.service';
import { ReorderPointsRepository } from './repositories/reorder-points.repository';

import { StockController } from './stock.controller';
import { StockService } from './stock.service';
import { StockRepository } from './repositories/stock.repository';

import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';
import { ReservationsRepository } from './repositories/reservations.repository';

import { AdjustmentsController } from './adjustments.controller';
import { AdjustmentsService } from './adjustments.service';
import { AdjustmentsRepository } from './repositories/adjustments.repository';

import { TransfersController } from './transfers.controller';
import { TransfersService } from './transfers.service';
import { TransfersRepository } from './repositories/transfers.repository';

import { CountsController } from './counts.controller';
import { CountsService } from './counts.service';
import { CountsRepository } from './repositories/counts.repository';

import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { AnalyticsRepository } from './repositories/analytics.repository';

import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ReportsRepository } from './repositories/reports.repository';

import { WmsController } from './wms.controller';
import { WmsService } from './wms.service';
import { WmsRepository } from './repositories/wms.repository';

import { PlanningController } from './planning.controller';
import { PlanningService } from './planning.service';
import { PlanningRepository } from './repositories/planning.repository';

import { AdvancedAnalyticsController } from './advanced-analytics.controller';
import { AdvancedAnalyticsService } from './advanced-analytics.service';
import { AdvancedAnalyticsRepository } from './repositories/advanced-analytics.repository';

import { SnapshotsController } from './snapshots.controller';
import { SnapshotsService } from './snapshots.service';
import { SnapshotsRepository } from './repositories/snapshots.repository';
import { ExpiredBatchesRepository } from './repositories/expired-batches.repository';
import { SerialsController } from './serials.controller';
import { CostLayersController } from './cost-layers.controller';
import { SerialsService } from './serials.service';
import { SerialsRepository } from './repositories/serials.repository';

import { PutawayController } from './putaway.controller';
import { PutawayService } from './putaway.service';
import { PutawayRepository } from './repositories/putaway.repository';

import { WarehouseTasksController } from './warehouse-tasks.controller';
import { WarehouseTasksService } from './warehouse-tasks.service';
import { WarehouseTasksRepository } from './repositories/warehouse-tasks.repository';

import { ReplenishmentController } from './replenishment.controller';
import { ReplenishmentService } from './replenishment.service';
import { ReplenishmentRepository } from './repositories/replenishment.repository';

@Module({
  imports: [
    SupabaseModule,
    PermissionsModule,
    ApprovalEngineModule,
    ItemsModule,
  ],
  controllers: [
    WarehousesController,
    LocationsController,
    ReorderPointsController,
    StockController,
    ReservationsController,
    AdjustmentsController,
    TransfersController,
    CountsController,
    AnalyticsController,
    ReportsController,
    WmsController,
    PlanningController,
    AdvancedAnalyticsController,
    SnapshotsController,
    SerialsController,
    CostLayersController,
    PutawayController,
    WarehouseTasksController,
    ReplenishmentController,
  ],
  providers: [
    WarehousesService,
    LocationsService,
    ReorderPointsService,
    StockService,
    ReservationsService,
    AdjustmentsService,
    TransfersService,
    CountsService,
    AnalyticsService,
    ReportsService,
    WmsService,
    PlanningService,
    AdvancedAnalyticsService,
    SnapshotsService,
    SerialsService,
    PutawayService,
    WarehouseTasksService,
    ReplenishmentService,
    {
      provide: WarehousesRepository,
      useFactory: (supabase: SupabaseClient) =>
        new WarehousesRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: LocationsRepository,
      useFactory: (supabase: SupabaseClient) =>
        new LocationsRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: ReorderPointsRepository,
      useFactory: (supabase: SupabaseClient) =>
        new ReorderPointsRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: StockRepository,
      useFactory: (
        supabase: SupabaseClient,
        tenantSession: TenantSessionService,
      ) => new StockRepository(supabase, tenantSession),
      inject: [SUPABASE_CLIENT, TenantSessionService],
    },
    {
      provide: ReservationsRepository,
      useFactory: (supabase: SupabaseClient) =>
        new ReservationsRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: AdjustmentsRepository,
      useFactory: (supabase: SupabaseClient) =>
        new AdjustmentsRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: TransfersRepository,
      useFactory: (supabase: SupabaseClient) =>
        new TransfersRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: CountsRepository,
      useFactory: (supabase: SupabaseClient) => new CountsRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: AnalyticsRepository,
      useFactory: (supabase: SupabaseClient) =>
        new AnalyticsRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: ReportsRepository,
      useFactory: (supabase: SupabaseClient) => new ReportsRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: WmsRepository,
      useFactory: (supabase: SupabaseClient) => new WmsRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: PlanningRepository,
      useFactory: (supabase: SupabaseClient) =>
        new PlanningRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: AdvancedAnalyticsRepository,
      useFactory: (supabase: SupabaseClient) =>
        new AdvancedAnalyticsRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: SnapshotsRepository,
      useFactory: (supabase: SupabaseClient) =>
        new SnapshotsRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: ExpiredBatchesRepository,
      useFactory: (supabase: SupabaseClient) =>
        new ExpiredBatchesRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: SerialsRepository,
      useFactory: (supabase: SupabaseClient) => new SerialsRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: PutawayRepository,
      useFactory: (supabase: SupabaseClient) => new PutawayRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: WarehouseTasksRepository,
      useFactory: (supabase: SupabaseClient) =>
        new WarehouseTasksRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: ReplenishmentRepository,
      useFactory: (supabase: SupabaseClient) =>
        new ReplenishmentRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
  ],
  exports: [
    WarehousesService,
    StockService,
    LocationsService,
    ExpiredBatchesRepository,
    SerialsRepository,
    PutawayService,
    LocationsRepository,
    WmsService,
    WarehouseTasksService,
    TransfersService,
    CountsService,
  ],
})
export class InventoryModule {}
