import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { InvoicesRepository } from './repositories/invoices.repository';
import { PosEngineModule } from '../../engines/pos-engine/pos-engine.module';
import { PaymentEngineModule } from '../../engines/payment-engine/payment-engine.module';
import { PermissionsModule } from '../../core/permissions/permissions.module';
import { CoreAuthModule } from '../../core/auth/auth.module';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';

@Module({
  imports: [PosEngineModule, PaymentEngineModule, PermissionsModule, CoreAuthModule],
  controllers: [InvoicesController],
  providers: [InvoicesService, InvoicesRepository, JwtAuthGuard],
  exports: [InvoicesService],
})
export class InvoicesModule {}