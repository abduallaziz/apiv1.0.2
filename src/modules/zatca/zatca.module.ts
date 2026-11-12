import { Module } from '@nestjs/common';
import { PermissionsModule } from '../../core/permissions/permissions.module';
import { ZatcaController } from './zatca.controller';
import { ZatcaService } from './zatca.service';
import { NullZatcaGateway, ZATCA_GATEWAY } from './zatca.gateway';

// ZATCA e-invoicing phase 2. Complete preparation: documents are generated, signed, chained and
// stored. The gateway is the no-op one until the connection to Fatoora is added (bind a
// FatooraGateway to ZATCA_GATEWAY then; nothing else changes).
@Module({
  imports: [PermissionsModule],
  controllers: [ZatcaController],
  providers: [ZatcaService, { provide: ZATCA_GATEWAY, useClass: NullZatcaGateway }],
  exports: [ZatcaService],
})
export class ZatcaModule {}
