import { Global, Module } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';
import { MetricsInterceptor } from './interceptors/metrics.interceptor';
import { BusinessCollector } from './collectors/business.collector';

@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService, MetricsInterceptor, BusinessCollector],
  exports: [MetricsService, MetricsInterceptor],
})
export class MetricsModule {}