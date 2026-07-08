import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CouponsRepository } from './coupons.repository';
import { DiscountEngine } from '../../engines/discount-engine/discount.engine';
import { TenantContext } from '../../core/tenant/tenant-context';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { UpdateCouponDto } from './dto/update-coupon.dto';

export interface Coupon {
  id: string;
  code: string;
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
  max_discount_amount: number | null;
  min_order_amount: number | null;
  max_uses: number | null;
  used_count: number;
  valid_from: string | null;
  valid_to: string | null;
  is_active: boolean;
}

@Injectable()
export class CouponsService {
  private readonly logger = new Logger(CouponsService.name);

  constructor(
    private readonly repo: CouponsRepository,
    private readonly discountEngine: DiscountEngine,
  ) {}

  findAll(tenant: TenantContext) {
    return this.repo.findAll(tenant);
  }

  async create(tenant: TenantContext, dto: CreateCouponDto) {
    const existing = await this.repo.findByCode(tenant, dto.code);
    if (existing) throw new BadRequestException('A coupon with this code already exists');
    return this.repo.create(tenant, { ...dto, code: dto.code.toUpperCase() } as CreateCouponDto);
  }

  async update(tenant: TenantContext, id: string, dto: UpdateCouponDto) {
    const existing = await this.repo.findById(tenant, id);
    if (!existing) throw new NotFoundException('Coupon not found');
    return this.repo.update(tenant, id, dto);
  }

  async remove(tenant: TenantContext, id: string) {
    const existing = await this.repo.findById(tenant, id);
    if (!existing) throw new NotFoundException('Coupon not found');
    await this.repo.softDelete(tenant, id);
    return { message: 'Coupon deleted' };
  }

  /** Validates a coupon code against checkout-time conditions. Throws on any failure — a rejected coupon must block checkout, not silently apply nothing. */
  async validate(tenant: TenantContext, code: string, subtotal: number): Promise<Coupon> {
    const coupon = await this.repo.findByCode(tenant, code);
    if (!coupon) throw new BadRequestException('Invalid coupon code');
    if (!coupon.is_active) throw new BadRequestException('This coupon is no longer active');

    const now = new Date();
    if (coupon.valid_from && new Date(coupon.valid_from) > now) {
      throw new BadRequestException('This coupon is not valid yet');
    }
    if (coupon.valid_to && new Date(coupon.valid_to) < now) {
      throw new BadRequestException('This coupon has expired');
    }
    if (coupon.max_uses !== null && coupon.used_count >= coupon.max_uses) {
      throw new BadRequestException('This coupon has reached its usage limit');
    }
    if (coupon.min_order_amount && subtotal < coupon.min_order_amount) {
      throw new BadRequestException(
        `This coupon requires a minimum order of ${coupon.min_order_amount}`,
      );
    }

    return coupon as Coupon;
  }

  calculateDiscount(coupon: Coupon, subtotal: number): number {
    const raw =
      coupon.discount_type === 'percentage'
        ? this.discountEngine.applyPercentageDiscount(subtotal, coupon.discount_value)
        : this.discountEngine.applyFixedDiscount(subtotal, coupon.discount_value);

    const capped = coupon.max_discount_amount
      ? this.discountEngine.checkMaxDiscount(raw, coupon.max_discount_amount)
      : raw;

    return this.discountEngine.checkMaxDiscount(capped, subtotal);
  }

  /**
   * Best-effort redemption, called after the order already exists — mirrors the stock-deduction
   * pattern (STATUS.md §64), not LoyaltyService.redeemPoints (which throws). A coupon race lost
   * after checkout already succeeded is a rare, low-stakes edge case; throwing at this point would
   * leave an already-committed order behind while the API call itself errors out to the client.
   */
  async redeem(couponId: string, orderId: string): Promise<void> {
    try {
      const result = await this.repo.redeem(couponId);
      if (result === null) {
        this.logger.warn(`Coupon ${couponId} redemption lost a race or was deactivated (order ${orderId})`);
      }
    } catch (err) {
      this.logger.warn(`Coupon redemption failed for order ${orderId}: ${(err as Error)?.message ?? err}`);
    }
  }
}
