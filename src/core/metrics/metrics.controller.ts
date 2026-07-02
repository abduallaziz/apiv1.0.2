import { Controller, Get, Header, Res } from '@nestjs/common';
import { Response } from 'express';
import { MetricsService } from './metrics.service';
import { Public } from '../../shared/decorators/public.decorator';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  @Public()
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  async getMetrics(@Res() res: Response): Promise<void> {
    const metrics = await this.metricsService.getMetrics();
    res.setHeader('Content-Type', this.metricsService.getContentType());
    res.send(metrics);
  }
}