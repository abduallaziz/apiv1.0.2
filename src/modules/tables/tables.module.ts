import { Module } from '@nestjs/common';
import { TablesController } from './tables.controller';
import { TablesService } from './tables.service';
import { TablesRepository } from './repositories/tables.repository';
import { DineInController } from './dine-in.controller';
import { DineInService } from './dine-in.service';
import { DineInRepository } from './repositories/dine-in.repository';
import { KitchenController } from './kitchen.controller';
import { KitchenService } from './kitchen.service';
import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';
import { ReservationsRepository } from './repositories/reservations.repository';
import { WaitlistController } from './waitlist.controller';
import { WaitlistService } from './waitlist.service';
import { WaitlistRepository } from './repositories/waitlist.repository';
import { InvoicesRepository } from '../invoices/repositories/invoices.repository';
import { TenantsRepository } from '../tenants/repositories/tenants.repository';
import { PosEngineModule } from '../../engines/pos-engine/pos-engine.module';
import { PaymentEngineModule } from '../../engines/payment-engine/payment-engine.module';
import { PermissionsModule } from '../../core/permissions/permissions.module';
import { CoreAuthModule } from '../../core/auth/auth.module';

@Module({
  imports: [PosEngineModule, PaymentEngineModule, PermissionsModule, CoreAuthModule],
  controllers: [
    TablesController,
    DineInController,
    KitchenController,
    ReservationsController,
    WaitlistController,
  ],
  providers: [
    TablesService,
    TablesRepository,
    DineInService,
    DineInRepository,
    KitchenService,
    ReservationsService,
    ReservationsRepository,
    WaitlistService,
    WaitlistRepository,
    InvoicesRepository,
    TenantsRepository,
  ],
})
export class TablesModule {}
