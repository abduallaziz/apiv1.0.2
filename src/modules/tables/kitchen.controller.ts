import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { KitchenService } from './kitchen.service';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant-context';
import { BranchScoped } from '../../core/security/branch-scoped.decorator';
import { EffectiveBranchId } from '../../core/security/effective-branch-id.decorator';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('kitchen')
export class KitchenController {
  constructor(private readonly service: KitchenService) {}

  // Branch Domain Batch 1, B2 (Owner-approved) — the live kitchen order
  // queue was previously visible across every branch to a restricted
  // actor who omitted/overrode branch_id; now forced to their own branch.
  @Get('orders')
  @RequirePermission('kitchen.manage')
  @BranchScoped()
  getActiveOrders(
    @GetTenant() tenant: TenantContext,
    @EffectiveBranchId() effectiveBranchId: string | null | undefined,
  ) {
    return this.service.getActiveOrders(tenant, effectiveBranchId ?? undefined);
  }

  @Patch('items/:id')
  @RequirePermission('kitchen.manage')
  updateItemStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @GetTenant() tenant: TenantContext,
    @Body('status') status: string,
  ) {
    return this.service.updateItemStatus(tenant, id, status);
  }
}
