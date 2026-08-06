import { Module } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseModule, SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';
import { PermissionsModule } from '../../core/permissions/permissions.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ItemsModule } from '../items/items.module';
import { ApprovalEngineModule } from '../../engines/approval-engine/approval-engine.module';
import { OwnershipModule } from '../ownership/ownership.module';
import { PurchasingModule } from '../purchasing/purchasing.module';

import { BomController } from './bom.controller';
import { BomService } from './bom.service';
import { BomRepository } from './repositories/bom.repository';

import { WorkCentersController } from './work-centers.controller';
import { WorkCentersService } from './work-centers.service';
import { WorkCentersRepository } from './repositories/work-centers.repository';

import { ProductionOrdersController } from './production-orders.controller';
import { ProductionOrdersService } from './production-orders.service';
import { ProductionOrdersRepository } from './repositories/production-orders.repository';

import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';
import { OperationsRepository } from './repositories/operations.repository';

import { ScrapController } from './scrap.controller';
import { ScrapService } from './scrap.service';
import { ScrapRepository } from './repositories/scrap.repository';

import { OutputsController } from './outputs.controller';
import { OutputsService } from './outputs.service';
import { OutputsRepository } from './repositories/outputs.repository';

import { SubcontractOrdersController } from './subcontract-orders.controller';
import { SubcontractOrdersService } from './subcontract-orders.service';
import { SubcontractOrdersRepository } from './repositories/subcontract-orders.repository';

// BOM (6.3), Work Centers (6.4), and Production Orders (6.6) implemented.
// Production Orders reuses BomRepository/WarehousesService/LocationsService/
// StockService directly — no duplicate inventory logic, no new module
// imports needed beyond what BOM/Work Centers already require.
// Migration 13.16A adds Routing (Operations) and Scrap Tracking, following
// the exact same sibling-trio pattern — no new module imports needed.
@Module({
  imports: [SupabaseModule, PermissionsModule, InventoryModule, ItemsModule, ApprovalEngineModule, OwnershipModule, PurchasingModule],
  controllers: [BomController, WorkCentersController, ProductionOrdersController, OperationsController, ScrapController, OutputsController, SubcontractOrdersController],
  providers: [
    BomService,
    WorkCentersService,
    ProductionOrdersService,
    OperationsService,
    ScrapService,
    OutputsService,
    SubcontractOrdersService,
    {
      provide: BomRepository,
      useFactory: (supabase: SupabaseClient) => new BomRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: WorkCentersRepository,
      useFactory: (supabase: SupabaseClient) => new WorkCentersRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: ProductionOrdersRepository,
      useFactory: (supabase: SupabaseClient) => new ProductionOrdersRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: OperationsRepository,
      useFactory: (supabase: SupabaseClient) => new OperationsRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: ScrapRepository,
      useFactory: (supabase: SupabaseClient) => new ScrapRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: OutputsRepository,
      useFactory: (supabase: SupabaseClient) => new OutputsRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: SubcontractOrdersRepository,
      useFactory: (supabase: SupabaseClient) => new SubcontractOrdersRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
  ],
  exports: [],
})
export class ManufacturingModule {}
