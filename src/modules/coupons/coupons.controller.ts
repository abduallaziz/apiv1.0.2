import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CouponsService } from './coupons.service';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant-context';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { UpdateCouponDto } from './dto/update-coupon.dto';
import { ValidateCouponDto } from './dto/validate-coupon.dto';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('coupons')
export class CouponsController {
  constructor(private readonly service: CouponsService) {}

  @Get()
  @RequirePermission('coupons.manage')
  findAll(@GetTenant() tenant: TenantContext) {
    return this.service.findAll(tenant);
  }

  // Preview-only — gated by invoice.create.own (same permission POS checkout itself
  // requires) rather than coupons.manage, since any cashier applying a code at
  // checkout needs to see its real discount before confirming payment, not just
  // whoever manages coupon definitions. Does NOT redeem/increment used_count — the
  // actual invoice creation re-validates and redeems atomically on its own.
  @Post('validate')
  @RequirePermission('invoice.create.own')
  async validate(@GetTenant() tenant: TenantContext, @Body() dto: ValidateCouponDto) {
    const coupon = await this.service.validate(tenant, dto.code, dto.subtotal);
    const discount_amount = this.service.calculateDiscount(coupon, dto.subtotal);
    return { code: coupon.code, discount_type: coupon.discount_type, discount_value: coupon.discount_value, discount_amount };
  }

  @Post()
  @RequirePermission('coupons.manage')
  create(@GetTenant() tenant: TenantContext, @Body() dto: CreateCouponDto) {
    return this.service.create(tenant, dto);
  }

  @Patch(':id')
  @RequirePermission('coupons.manage')
  update(
    @GetTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body() dto: UpdateCouponDto,
  ) {
    return this.service.update(tenant, id, dto);
  }

  @Delete(':id')
  @RequirePermission('coupons.manage')
  remove(@GetTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.service.remove(tenant, id);
  }
}
