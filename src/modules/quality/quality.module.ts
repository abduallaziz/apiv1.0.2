import { Module } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseModule, SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';
import { PermissionsModule } from '../../core/permissions/permissions.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ItemsModule } from '../items/items.module';
import { ApprovalEngineModule } from '../../engines/approval-engine/approval-engine.module';

import { InspectionsController } from './inspections.controller';
import { InspectionsService } from './inspections.service';
import { InspectionsRepository } from './repositories/inspections.repository';

import { HoldsController } from './holds.controller';
import { HoldsService } from './holds.service';
import { HoldsRepository } from './repositories/holds.repository';

import { NonConformancesController } from './non-conformances.controller';
import { NonConformancesService } from './non-conformances.service';
import { NonConformancesRepository } from './repositories/non-conformances.repository';

// Quality Management (#19, Migration 8.2) — a dedicated domain module, same
// shape as ManufacturingModule (three sub-domain trios: Inspections/Holds/
// Non-Conformances), not folded into InventoryModule. Holds are advisory
// only — HoldsRepository.checkHolds() is exported for InvoicesModule to
// consume directly; nothing in this module can block a sale.
@Module({
  imports: [SupabaseModule, PermissionsModule, InventoryModule, ItemsModule, ApprovalEngineModule],
  controllers: [InspectionsController, HoldsController, NonConformancesController],
  providers: [
    InspectionsService,
    HoldsService,
    NonConformancesService,
    {
      provide: InspectionsRepository,
      useFactory: (supabase: SupabaseClient) => new InspectionsRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: HoldsRepository,
      useFactory: (supabase: SupabaseClient) => new HoldsRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: NonConformancesRepository,
      useFactory: (supabase: SupabaseClient) => new NonConformancesRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
  ],
  exports: [HoldsService, HoldsRepository],
})
export class QualityModule {}
