import { Injectable } from '@nestjs/common';
import { DiscountEngine } from '../discount-engine/discount.engine';

export interface InvoiceItem {
  item_id: string;
  item_name: string;
  variant_id?: string;
  variant_name?: string;
  quantity: number;
  unit_price: number;
}

export interface BuiltInvoice {
  items: InvoiceItem[];
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  total: number;
}

export interface DiscountInput {
  type: 'percentage' | 'fixed';
  value: number;
  max_allowed?: number;
}

@Injectable()
export class PosEngine {
  constructor(private readonly discountEngine: DiscountEngine) {}

  calculateSubtotal(items: InvoiceItem[]): number {
    const subtotal = items.reduce(
      (sum, item) => sum + item.unit_price * item.quantity,
      0,
    );
    return parseFloat(subtotal.toFixed(2));
  }

  applyDiscount(subtotal: number, discount?: DiscountInput): number {
    if (!discount) return 0;

    let discountAmount =
      discount.type === 'percentage'
        ? this.discountEngine.applyPercentageDiscount(subtotal, discount.value)
        : this.discountEngine.applyFixedDiscount(subtotal, discount.value);

    if (discount.max_allowed !== undefined) {
      discountAmount = this.discountEngine.checkMaxDiscount(
        discountAmount,
        discount.max_allowed,
      );
    }

    return discountAmount;
  }

  applyTax(subtotal: number, discountAmount: number, taxRate: number): number {
    const taxable = subtotal - discountAmount;
    return parseFloat(((taxable * taxRate) / 100).toFixed(2));
  }

  calculateTotal(
    subtotal: number,
    discountAmount: number,
    taxAmount: number,
  ): number {
    return parseFloat((subtotal - discountAmount + taxAmount).toFixed(2));
  }

  buildInvoice(
    items: InvoiceItem[],
    discount?: DiscountInput,
    taxRate: number = 15,
  ): BuiltInvoice {
    const subtotal = this.calculateSubtotal(items);
    const discount_amount = this.applyDiscount(subtotal, discount);
    const tax_amount = this.applyTax(subtotal, discount_amount, taxRate);
    const total = this.calculateTotal(subtotal, discount_amount, tax_amount);

    return { items, subtotal, discount_amount, tax_amount, total };
  }
}