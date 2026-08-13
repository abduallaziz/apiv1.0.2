import { Module } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import {
  SupabaseModule,
  SUPABASE_CLIENT,
} from '../../shared/supabase/supabase.module';
import { PermissionsModule } from '../../core/permissions/permissions.module';
import { ItemsModule } from '../items/items.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PurchasingModule } from '../purchasing/purchasing.module';
import { ManufacturingModule } from '../manufacturing/manufacturing.module';

import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { DevicesRepository } from './repositories/devices.repository';

import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { EventsRepository } from './repositories/events.repository';
import { SessionsRepository } from './repositories/sessions.repository';
import { ScannerAuditLogsRepository } from './repositories/audit-logs.repository';

import { ResolverController } from './resolver/resolver.controller';
import { ResolverService } from './resolver/resolver.service';
import { ItemBarcodeResolver } from './resolver/item-barcode.resolver';
import { LocationResolver } from './resolver/location.resolver';
import { BatchResolver } from './resolver/batch.resolver';
import { SerialResolver } from './resolver/serial.resolver';
import { RfidResolver } from './resolver/rfid.resolver';
import { BatchesLookupRepository } from './resolver/repositories/batches-lookup.repository';
import { RfidTagsRepository } from './resolver/repositories/rfid-tags.repository';

import { ActionExecutorService } from './actions/action-executor.service';
import { ActionRegistry } from './actions/action-registry';
import { ScannerActionsRepository } from './repositories/scanner-actions.repository';
import { ReceivingAction } from './actions/handlers/receiving.action';
import { PutawayAction } from './actions/handlers/putaway.action';
import { PickingAction } from './actions/handlers/picking.action';
import { PackingAction } from './actions/handlers/packing.action';
import { ShippingAction } from './actions/handlers/shipping.action';
import { TransferAction } from './actions/handlers/transfer.action';
import { CountingAction } from './actions/handlers/counting.action';
import { ManufacturingAction } from './actions/handlers/manufacturing.action';

// Sefay Universal Device Platform (#21). Phase 2 laid the database
// foundation. Phase 3 is Device Management. Phase 4 is the Scanner Event
// Engine. Phase 5 is the Resolver Engine (identification only, read-only).
// Phase 6 is the Adapter Framework (hardware-format parsing, a standalone
// library with no NestJS wiring — see adapters/). Phase 7 is the Action
// Framework: a thin mapping layer from (resolved entity + workflow
// context) to an EXISTING Sefay service call — it imports PurchasingModule/
// InventoryModule/ManufacturingModule ONLY for their already-existing
// public services (GoodsReceiptsService, WmsService, WarehouseTasksService,
// TransfersService, CountsService, ProductionOrdersService), never their
// repositories/RPCs directly, and contains no stock/cost/reservation logic
// of its own.
@Module({
  imports: [
    SupabaseModule,
    PermissionsModule,
    ItemsModule,
    InventoryModule,
    PurchasingModule,
    ManufacturingModule,
  ],
  controllers: [DevicesController, EventsController, ResolverController],
  providers: [
    DevicesService,
    EventsService,
    ResolverService,
    ItemBarcodeResolver,
    LocationResolver,
    BatchResolver,
    SerialResolver,
    RfidResolver,
    ActionExecutorService,
    ActionRegistry,
    ReceivingAction,
    PutawayAction,
    PickingAction,
    PackingAction,
    ShippingAction,
    TransferAction,
    CountingAction,
    ManufacturingAction,
    {
      provide: DevicesRepository,
      useFactory: (supabase: SupabaseClient) => new DevicesRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: EventsRepository,
      useFactory: (supabase: SupabaseClient) => new EventsRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: SessionsRepository,
      useFactory: (supabase: SupabaseClient) =>
        new SessionsRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: ScannerAuditLogsRepository,
      useFactory: (supabase: SupabaseClient) =>
        new ScannerAuditLogsRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: BatchesLookupRepository,
      useFactory: (supabase: SupabaseClient) =>
        new BatchesLookupRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: RfidTagsRepository,
      useFactory: (supabase: SupabaseClient) =>
        new RfidTagsRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: ScannerActionsRepository,
      useFactory: (supabase: SupabaseClient) =>
        new ScannerActionsRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
  ],
  exports: [
    DevicesService,
    EventsService,
    ResolverService,
    ActionExecutorService,
  ],
})
export class ScannerModule {}
