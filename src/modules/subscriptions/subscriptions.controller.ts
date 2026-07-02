import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { SubscriptionsService } from './subscriptions.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';

@Controller('subscriptions')
@UseGuards(JwtAuthGuard)
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  private resolveTenant(tenant: TenantContext | undefined, req: Request): TenantContext {
    if (tenant) return tenant;
    // superadmin bypass — build TenantContext from JWT
    const user = req.user as { tenant_id: string; sub: string; role: string };
    return { tenantId: user.tenant_id } as TenantContext;
  }

  @Get('current')
  getCurrent(@GetTenant() tenant: TenantContext, @Req() req: Request) {
    return this.subscriptionsService.getCurrent(this.resolveTenant(tenant, req));
  }

  @Post('upgrade')
  upgrade(
    @GetTenant() tenant: TenantContext,
    @Req() req: Request,
    @Body() dto: CreateSubscriptionDto,
  ) {
    return this.subscriptionsService.upgrade(this.resolveTenant(tenant, req), dto);
  }

  @Delete('cancel')
  cancel(@GetTenant() tenant: TenantContext, @Req() req: Request) {
    return this.subscriptionsService.cancel(this.resolveTenant(tenant, req));
  }
}