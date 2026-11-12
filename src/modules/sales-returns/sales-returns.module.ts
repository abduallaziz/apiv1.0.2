import { Module } from '@nestjs/common';
import { SalesReturnsController } from './sales-returns.controller';
import { SalesReturnsService } from './sales-returns.service';
import { SalesReturnsRepository } from './sales-returns.repository';
import { PermissionsModule } from '../../core/permissions/permissions.module';
import { ZatcaModule } from '../zatca/zatca.module';

@Module({
  imports: [PermissionsModule, ZatcaModule],
  controllers: [SalesReturnsController],
  providers: [SalesReturnsService, SalesReturnsRepository],
  exports: [SalesReturnsRepository],
})
export class SalesReturnsModule {}
