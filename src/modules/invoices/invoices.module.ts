import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { InvoicesRepository } from './repositories/invoices.repository';
import { TenantsRepository } from '../tenants/repositories/tenants.repository';
import { PosEngineModule } from '../../engines/pos-engine/pos-engine.module';
import { PaymentEngineModule } from '../../engines/payment-engine/payment-engine.module';
import { PermissionsModule } from '../../core/permissions/permissions.module';
import { CoreAuthModule } from '../../core/auth/auth.module';
import { NotificationModule } from '../../core/notification/notification.module';
import { LoyaltyModule } from '../../core/loyalty/loyalty.module';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';

@Module({
  imports: [PosEngineModule, PaymentEngineModule, PermissionsModule, CoreAuthModule, NotificationModule, LoyaltyModule],
  controllers: [InvoicesController],
  providers: [InvoicesService, InvoicesRepository, TenantsRepository, JwtAuthGuard],
  exports: [InvoicesService],
})
export class InvoicesModule {}