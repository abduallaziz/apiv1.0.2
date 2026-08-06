import { Module } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseModule, SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';
import { PermissionsModule } from '../../core/permissions/permissions.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ItemsModule } from '../items/items.module';

import { OwnershipController } from './ownership.controller';
import { OwnershipService } from './ownership.service';
import { OwnershipRepository } from './repositories/ownership.repository';

// Inventory Ownership (#20, Migration 10.1) — a dedicated domain module,
// same shape as ManufacturingModule/QualityModule, not folded into
// InventoryModule. stock_ownership_layers is an overlay: stock_levels,
// stock_movements, cost_layers, fn_apply_stock_movement, and the costing
// engine are never touched by anything in this module.
// OwnershipRepository is exported for InvoicesModule (sale-time
// consumption + advisory) and ManufacturingModule (owned-component guard).
@Module({
  imports: [SupabaseModule, PermissionsModule, InventoryModule, ItemsModule],
  controllers: [OwnershipController],
  providers: [
    OwnershipService,
    {
      provide: OwnershipRepository,
      useFactory: (supabase: SupabaseClient) => new OwnershipRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
  ],
  exports: [OwnershipService, OwnershipRepository],
})
export class OwnershipModule {}
