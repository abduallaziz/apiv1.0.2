import { Module } from '@nestjs/common';
import { GiftCardsController } from './gift-cards.controller';
import { GiftCardsService } from './gift-cards.service';
import { GiftCardsRepository } from './gift-cards.repository';
import { PermissionsModule } from '../../core/permissions/permissions.module';
import { CoreAuthModule } from '../../core/auth/auth.module';

@Module({
  imports: [PermissionsModule, CoreAuthModule],
  controllers: [GiftCardsController],
  providers: [GiftCardsService, GiftCardsRepository],
  exports: [GiftCardsService],
})
export class GiftCardsModule {}
