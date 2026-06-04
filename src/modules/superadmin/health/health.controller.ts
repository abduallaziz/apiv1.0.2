import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../../core/permissions/permission.guard';
import { RequirePermission } from '../../../core/permissions/require-permission.decorator';
import { HealthService } from './health.service';

@Controller('superadmin/health')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @RequirePermission('superadmin.health.view')
  async getHealth() {
    return this.healthService.getOverallHealth();
  }

  @Get('db')
  @RequirePermission('superadmin.health.view')
  async getDatabaseHealth() {
    return this.healthService.checkDatabase();
  }

  @Get('redis')
  @RequirePermission('superadmin.health.view')
  async getRedisHealth() {
    return this.healthService.checkRedis();
  }

  @Get('queues')
  @RequirePermission('superadmin.health.view')
  async getQueuesHealth() {
    return this.healthService.checkQueues();
  }
}