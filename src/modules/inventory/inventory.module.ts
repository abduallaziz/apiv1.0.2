import { Module } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseModule, SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';
import { PermissionsModule } from '../../core/permissions/permissions.module';

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

@Module({
  imports: [SupabaseModule, PermissionsModule],
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
    {
      provide: WarehousesRepository,
      useFactory: (supabase: SupabaseClient) => new WarehousesRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: LocationsRepository,
      useFactory: (supabase: SupabaseClient) => new LocationsRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: ReorderPointsRepository,
      useFactory: (supabase: SupabaseClient) => new ReorderPointsRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: StockRepository,
      useFactory: (supabase: SupabaseClient) => new StockRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: ReservationsRepository,
      useFactory: (supabase: SupabaseClient) => new ReservationsRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: AdjustmentsRepository,
      useFactory: (supabase: SupabaseClient) => new AdjustmentsRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: TransfersRepository,
      useFactory: (supabase: SupabaseClient) => new TransfersRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: CountsRepository,
      useFactory: (supabase: SupabaseClient) => new CountsRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: AnalyticsRepository,
      useFactory: (supabase: SupabaseClient) => new AnalyticsRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: ReportsRepository,
      useFactory: (supabase: SupabaseClient) => new ReportsRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
  ],
  exports: [WarehousesService, StockService],
})
export class InventoryModule {}
