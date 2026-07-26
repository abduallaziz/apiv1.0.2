import { Module } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import {
  SupabaseModule,
  SUPABASE_CLIENT,
} from '../../shared/supabase/supabase.module';
import { PermissionsModule } from '../../core/permissions/permissions.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ApprovalEngineModule } from '../../engines/approval-engine/approval-engine.module';

import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';
import { SuppliersRepository } from './repositories/suppliers.repository';

import { PurchaseRequestsController } from './purchase-requests.controller';
import { PurchaseRequestsService } from './purchase-requests.service';
import { PurchaseRequestsRepository } from './repositories/purchase-requests.repository';

import { RfqsController } from './rfqs.controller';
import { RfqsService } from './rfqs.service';
import { RfqsRepository } from './repositories/rfqs.repository';

import { AgreementsController } from './agreements.controller';
import { AgreementsService } from './agreements.service';
import { AgreementsRepository } from './repositories/agreements.repository';

import { AmendmentsController } from './amendments.controller';
import { AmendmentsService } from './amendments.service';
import { AmendmentsRepository } from './repositories/amendments.repository';

import { SupplierQuotesController } from './supplier-quotes.controller';
import { SupplierQuotesService } from './supplier-quotes.service';
import { SupplierQuotesRepository } from './repositories/supplier-quotes.repository';

import { AwardsController } from './awards.controller';
import { AwardsService } from './awards.service';
import { AwardsRepository } from './repositories/awards.repository';

import { PurchaseOrdersController } from './purchase-orders.controller';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PurchaseOrdersRepository } from './repositories/purchase-orders.repository';

import { GoodsReceiptsController } from './goods-receipts.controller';
import { GoodsReceiptsService } from './goods-receipts.service';
import { GoodsReceiptsRepository } from './repositories/goods-receipts.repository';

@Module({
  imports: [
    SupabaseModule,
    PermissionsModule,
    InventoryModule,
    ApprovalEngineModule,
  ],
  controllers: [
    SuppliersController,
    PurchaseRequestsController,
    RfqsController,
    AgreementsController,
    AmendmentsController,
    SupplierQuotesController,
    AwardsController,
    PurchaseOrdersController,
    GoodsReceiptsController,
  ],
  providers: [
    SuppliersService,
    PurchaseRequestsService,
    RfqsService,
    AgreementsService,
    AmendmentsService,
    SupplierQuotesService,
    AwardsService,
    PurchaseOrdersService,
    GoodsReceiptsService,
    {
      provide: SuppliersRepository,
      useFactory: (supabase: SupabaseClient) =>
        new SuppliersRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: PurchaseRequestsRepository,
      useFactory: (supabase: SupabaseClient) =>
        new PurchaseRequestsRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: RfqsRepository,
      useFactory: (supabase: SupabaseClient) => new RfqsRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: AgreementsRepository,
      useFactory: (supabase: SupabaseClient) =>
        new AgreementsRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: AmendmentsRepository,
      useFactory: (supabase: SupabaseClient) =>
        new AmendmentsRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: SupplierQuotesRepository,
      useFactory: (supabase: SupabaseClient) =>
        new SupplierQuotesRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: AwardsRepository,
      useFactory: (supabase: SupabaseClient) => new AwardsRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: PurchaseOrdersRepository,
      useFactory: (supabase: SupabaseClient) =>
        new PurchaseOrdersRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: GoodsReceiptsRepository,
      useFactory: (supabase: SupabaseClient) =>
        new GoodsReceiptsRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
  ],
  exports: [
    SuppliersService,
    PurchaseRequestsService,
    RfqsService,
    AgreementsService,
    AmendmentsService,
    SupplierQuotesService,
    AwardsService,
    PurchaseOrdersService,
    GoodsReceiptsService,
  ],
})
export class PurchasingModule {}
