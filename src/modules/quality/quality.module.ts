import { Module } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseModule, SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';
import { PermissionsModule } from '../../core/permissions/permissions.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ItemsModule } from '../items/items.module';

import { InspectionsController } from './inspections.controller';
import { InspectionsService } from './inspections.service';
import { InspectionsRepository } from './repositories/inspections.repository';

import { HoldsController } from './holds.controller';
import { HoldsService } from './holds.service';
import { HoldsRepository } from './repositories/holds.repository';

import { NonConformancesController } from './non-conformances.controller';
import { NonConformancesService } from './non-conformances.service';
import { NonConformancesRepository } from './repositories/non-conformances.repository';

import { CorrectiveActionsController } from './corrective-actions.controller';
import { CorrectiveActionsService } from './corrective-actions.service';
import { CorrectiveActionsRepository } from './repositories/corrective-actions.repository';

import { DeviationsController } from './deviations.controller';
import { DeviationsService } from './deviations.service';
import { DeviationsRepository } from './repositories/deviations.repository';

import { TemplatesController } from './templates.controller';
import { PlansController } from './plans.controller';
import { RulesController } from './rules.controller';
import { QualityConfigService } from './quality-config.service';
import { QualityConfigRepository } from './repositories/quality-config.repository';

import { SupplierQualityController } from './supplier-quality.controller';
import { SupplierQualityRepository } from './repositories/supplier-quality.repository';

import { QualityAnalyticsController } from './quality-analytics.controller';
import { QualityAnalyticsRepository } from './repositories/quality-analytics.repository';

// Quality Management (#19). Migration 8.2 built the original foundation
// (Inspections/Holds/Non-Conformances). Migration 13.19 completes it:
// hard-block Quality Hold (schema in migrations 163/164/166, application
// layer here), Templates/Plans/Rules (quality-config, shared repository —
// three small closely-related configuration entities), full NCR lifecycle,
// Defect tracking, CAPA (corrective-actions), Deviations, Supplier Quality
// (a live view, not a duplicated/stale table), and Quality Analytics
// (reuses the Advanced Analytics pattern). Customer Complaints and
// Rework/Disposition were folded into non_conformances/quality_holds per
// the approved scope decision — no separate modules.
//
// HoldsRepository is exported (as before) for InvoicesModule's advisory
// pre-sale warning; the hard block itself is now enforced structurally by
// fn_create_reservation/fn_apply_stock_movement (Inventory Core), not by
// this module — HoldsService/Repository no longer need to be the actual
// enforcement point.
@Module({
  imports: [SupabaseModule, PermissionsModule, InventoryModule, ItemsModule],
  controllers: [
    InspectionsController,
    HoldsController,
    NonConformancesController,
    CorrectiveActionsController,
    DeviationsController,
    TemplatesController,
    PlansController,
    RulesController,
    SupplierQualityController,
    QualityAnalyticsController,
  ],
  providers: [
    InspectionsService,
    HoldsService,
    NonConformancesService,
    CorrectiveActionsService,
    DeviationsService,
    QualityConfigService,
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
    {
      provide: CorrectiveActionsRepository,
      useFactory: (supabase: SupabaseClient) => new CorrectiveActionsRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: DeviationsRepository,
      useFactory: (supabase: SupabaseClient) => new DeviationsRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: QualityConfigRepository,
      useFactory: (supabase: SupabaseClient) => new QualityConfigRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: SupplierQualityRepository,
      useFactory: (supabase: SupabaseClient) => new SupplierQualityRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: QualityAnalyticsRepository,
      useFactory: (supabase: SupabaseClient) => new QualityAnalyticsRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
  ],
  exports: [HoldsService, HoldsRepository, QualityConfigService, InspectionsService],
})
export class QualityModule {}
