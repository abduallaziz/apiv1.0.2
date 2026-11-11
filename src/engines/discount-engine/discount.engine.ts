import { Injectable } from '@nestjs/common';

@Injectable()
export class DiscountEngine {
  applyPercentageDiscount(subtotal: number, percent: number): number {
    // A percentage discount can never exceed 100% (would make the total
    // negative) nor be negative (would act as a surcharge).
    const pct = Math.min(Math.max(percent, 0), 100);
    return parseFloat(((subtotal * pct) / 100).toFixed(2));
  }

  applyFixedDiscount(subtotal: number, amount: number): number {
    return parseFloat(Math.max(Math.min(amount, subtotal), 0).toFixed(2));
  }

  checkMaxDiscount(discount: number, maxAllowed: number): number {
    return parseFloat(Math.min(discount, maxAllowed).toFixed(2));
  }
}
