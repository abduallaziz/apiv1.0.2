import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PerfTrackingService } from './perf-tracking.service';

@Controller('internal/perf-metrics')
@UseGuards(JwtAuthGuard)
export class PerfTrackingController {
  constructor(private readonly perfTracking: PerfTrackingService) {}

  @Get()
  getSnapshot() {
    return this.perfTracking.getSnapshot();
  }
}
