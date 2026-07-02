import { Module } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseModule, SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';
import { PermissionsModule } from '../../core/permissions/permissions.module';
import { InventoryModule } from '../inventory/inventory.module';

import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';
import { SuppliersRepository } from './repositories/suppliers.repository';

import { PurchaseOrdersController } from './purchase-orders.controller';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PurchaseOrdersRepository } from './repositories/purchase-orders.repository';

import { GoodsReceiptsController } from './goods-receipts.controller';
import { GoodsReceiptsService } from './goods-receipts.service';
import { GoodsReceiptsRepository } from './repositories/goods-receipts.repository';

@Module({
  imports: [SupabaseModule, PermissionsModule, InventoryModule],
  controllers: [SuppliersController, PurchaseOrdersController, GoodsReceiptsController],
  providers: [
    SuppliersService,
    PurchaseOrdersService,
    GoodsReceiptsService,
    {
      provide: SuppliersRepository,
      useFactory: (supabase: SupabaseClient) => new SuppliersRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: PurchaseOrdersRepository,
      useFactory: (supabase: SupabaseClient) => new PurchaseOrdersRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: GoodsReceiptsRepository,
      useFactory: (supabase: SupabaseClient) => new GoodsReceiptsRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
  ],
  exports: [SuppliersService, PurchaseOrdersService, GoodsReceiptsService],
})
export class PurchasingModule {}
