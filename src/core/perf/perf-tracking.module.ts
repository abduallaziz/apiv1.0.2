import { Global, Module } from '@nestjs/common';
import { PerfTrackingService } from './perf-tracking.service';
import { PerfTrackingController } from './perf-tracking.controller';
import { PerfTrackingInterceptor } from './interceptors/perf-tracking.interceptor';
import { CoreAuthModule } from '../auth/auth.module';
import { RedisCacheModule } from '../cache/redis-cache.module';

@Global()
@Module({
  imports: [CoreAuthModule, RedisCacheModule],
  controllers: [PerfTrackingController],
  providers: [PerfTrackingService, PerfTrackingInterceptor],
  exports: [PerfTrackingService, PerfTrackingInterceptor],
})
export class PerfTrackingModule {}
