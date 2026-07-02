import { Global, Module } from '@nestjs/common';
import { AiUsageTrackingService } from './ai-usage-tracking.service';
import { AiUsageTrackingController } from './ai-usage-tracking.controller';
import { CoreAuthModule } from '../auth/auth.module';
import { RedisCacheModule } from '../cache/redis-cache.module';

@Global()
@Module({
  imports: [CoreAuthModule, RedisCacheModule],
  controllers: [AiUsageTrackingController],
  providers: [AiUsageTrackingService],
  exports: [AiUsageTrackingService],
})
export class AiUsageTrackingModule {}
