import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PermissionsModule } from '../../core/permissions/permissions.module';
import { ZatcaController } from './zatca.controller';
import { ZatcaService } from './zatca.service';
import { FatooraGateway } from './fatoora.gateway';
import { NullZatcaGateway, ZATCA_GATEWAY } from './zatca.gateway';

// ZATCA e-invoicing phase 2. Documents are generated, signed, chained and stored; ZATCA_GATEWAY
// ('null' by default) decides whether they are also sent to the Authority ('fatoora').
@Module({
  imports: [PermissionsModule],
  controllers: [ZatcaController],
  providers: [
    ZatcaService,
    {
      provide: ZATCA_GATEWAY,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.get<string>('ZATCA_GATEWAY') === 'fatoora' ? new FatooraGateway() : new NullZatcaGateway(),
    },
  ],
  exports: [ZatcaService],
})
export class ZatcaModule {}
