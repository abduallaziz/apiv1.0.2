import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AiUsageTrackingService } from './ai-usage-tracking.service';

@Controller('internal/ai-usage')
@UseGuards(JwtAuthGuard)
export class AiUsageTrackingController {
  constructor(private readonly aiUsage: AiUsageTrackingService) {}

  /** Returns per-job-type usage counters and token totals for all tenants. */
  @Get()
  getSnapshot(@Query('tenant_id') tenantId?: string) {
    return this.aiUsage.getSnapshot(tenantId);
  }
}
