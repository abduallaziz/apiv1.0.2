import { Injectable } from '@nestjs/common';

@Injectable()
export class DiscountEngine {
  applyPercentageDiscount(subtotal: number, percent: number): number {
    return parseFloat(((subtotal * percent) / 100).toFixed(2));
  }

  applyFixedDiscount(subtotal: number, amount: number): number {
    return parseFloat(Math.min(amount, subtotal).toFixed(2));
  }

  checkMaxDiscount(discount: number, maxAllowed: number): number {
    return parseFloat(Math.min(discount, maxAllowed).toFixed(2));
  }
}