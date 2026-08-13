import { Module } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import {
  SupabaseModule,
  SUPABASE_CLIENT,
} from '../../shared/supabase/supabase.module';
import { PermissionsModule } from '../../core/permissions/permissions.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ItemsModule } from '../items/items.module';
import { ApprovalEngineModule } from '../../engines/approval-engine/approval-engine.module';
import { DiscountEngineModule } from '../../engines/discount-engine/discount-engine.module';
import { QualityModule } from '../quality/quality.module';

import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';
import { SuppliersRepository } from './repositories/suppliers.repository';

import { SupplierItemsController } from './supplier-items.controller';
import { SupplierItemsService } from './supplier-items.service';
import { SupplierItemsRepository } from './repositories/supplier-items.repository';

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

import { ReleasesController } from './releases.controller';
import { ReleasesService } from './releases.service';
import { ReleasesRepository } from './repositories/releases.repository';

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

import { LandedCostsController } from './landed-costs.controller';
import { LandedCostsService } from './landed-costs.service';
import { LandedCostsRepository } from './repositories/landed-costs.repository';

@Module({
  imports: [
    SupabaseModule,
    PermissionsModule,
    InventoryModule,
    ItemsModule,
    ApprovalEngineModule,
    DiscountEngineModule,
    QualityModule,
  ],
  controllers: [
    SuppliersController,
    SupplierItemsController,
    PurchaseRequestsController,
    RfqsController,
    AgreementsController,
    AmendmentsController,
    ReleasesController,
    SupplierQuotesController,
    AwardsController,
    PurchaseOrdersController,
    GoodsReceiptsController,
    LandedCostsController,
  ],
  providers: [
    SuppliersService,
    SupplierItemsService,
    PurchaseRequestsService,
    RfqsService,
    AgreementsService,
    AmendmentsService,
    ReleasesService,
    SupplierQuotesService,
    AwardsService,
    PurchaseOrdersService,
    GoodsReceiptsService,
    LandedCostsService,
    {
      provide: SuppliersRepository,
      useFactory: (supabase: SupabaseClient) =>
        new SuppliersRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: SupplierItemsRepository,
      useFactory: (supabase: SupabaseClient) =>
        new SupplierItemsRepository(supabase),
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
      provide: ReleasesRepository,
      useFactory: (supabase: SupabaseClient) =>
        new ReleasesRepository(supabase),
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
    {
      provide: LandedCostsRepository,
      useFactory: (supabase: SupabaseClient) =>
        new LandedCostsRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
  ],
  exports: [
    SuppliersService,
    PurchaseRequestsService,
    RfqsService,
    AgreementsService,
    AmendmentsService,
    ReleasesService,
    SupplierQuotesService,
    AwardsService,
    PurchaseOrdersService,
    GoodsReceiptsService,
  ],
})
export class PurchasingModule {}
