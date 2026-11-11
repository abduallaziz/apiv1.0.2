import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { RewardInstancesRepository } from './reward-instances.repository';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant-context';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';

/**
 * Suggestion surface only — "N rewards available" / "use 3 rewards?" per
 * the approved architecture. Listing here never redeems anything; only
 * POST /invoices with redeem_reward_instance_ids (explicit confirmation)
 * does. Gated by invoice.create.own, same permission POS checkout itself
 * requires — any cashier building a sale needs to see a customer's
 * available rewards, not just whoever manages reward definitions.
 */
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('customers')
export class CustomerRewardsController {
  constructor(private readonly instancesRepo: RewardInstancesRepository) {}

  @Get(':customerId/rewards')
  @RequirePermission('invoice.create.own')
  findAvailable(
    @GetTenant() tenant: TenantContext,
    @Param('customerId') customerId: string,
    @Query('status') status?: string,
  ) {
    return this.instancesRepo.findByCustomer(
      tenant,
      customerId,
      status ?? 'unlocked',
    );
  }
}
