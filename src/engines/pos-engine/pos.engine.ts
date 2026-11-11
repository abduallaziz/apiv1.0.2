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

  // taxInclusive defaults to false so every existing caller that doesn't
  // pass it (dine-in — out of this Phase-1 scope) keeps today's exact
  // exclusive behavior, unchanged.
  applyTax(
    subtotal: number,
    discountAmount: number,
    taxRate: number,
    taxInclusive: boolean = false,
  ): number {
    // taxRate is a fraction (e.g. 0.15 for 15%), matching tenants.tax_rate in the DB.
    const afterDiscount = subtotal - discountAmount;
    if (taxInclusive) {
      // subtotal is the GROSS (already-VAT-included) amount here. Tax is
      // derived by subtraction (gross - base), never independently rounded
      // as gross*rate/(1+rate) — subtraction is the only way to guarantee
      // base + tax reconciles exactly to the gross figure in every case,
      // per the approved design.
      const base = parseFloat((afterDiscount / (1 + taxRate)).toFixed(2));
      return parseFloat((afterDiscount - base).toFixed(2));
    }
    return parseFloat((afterDiscount * taxRate).toFixed(2));
  }

  calculateTotal(
    subtotal: number,
    discountAmount: number,
    taxAmount: number,
    taxInclusive: boolean = false,
  ): number {
    if (taxInclusive) {
      // The gross amount (after discount) already IS the total — tax is a
      // component already inside it, never added again.
      return parseFloat((subtotal - discountAmount).toFixed(2));
    }
    return parseFloat((subtotal - discountAmount + taxAmount).toFixed(2));
  }

  buildInvoice(
    items: InvoiceItem[],
    discount?: DiscountInput,
    taxRate: number = 0.15,
    taxInclusive: boolean = false,
  ): BuiltInvoice {
    const rawSubtotal = this.calculateSubtotal(items);
    const discount_amount = this.applyDiscount(rawSubtotal, discount);
    const tax_amount = this.applyTax(
      rawSubtotal,
      discount_amount,
      taxRate,
      taxInclusive,
    );
    const total = this.calculateTotal(
      rawSubtotal,
      discount_amount,
      tax_amount,
      taxInclusive,
    );
    // Stored/returned `subtotal` always means the PRE-discount net figure,
    // in both modes — this is required, not just a style choice: the
    // accounting-posting engine (fn_post_sales_order, migration 184)
    // enforces subtotal - discount + tax = total unconditionally. Since
    // `total` already has the discount baked in (total = rawSubtotal -
    // discount, or its inclusive-mode equivalent), solving that identity
    // for subtotal gives subtotal = rawSubtotal - tax_amount — algebraically
    // guaranteed to reconcile regardless of discount, and it collapses to
    // the exact same value as `rawSubtotal` when there's no discount
    // (matching the exclusive-mode figure and the canonical no-discount
    // inclusive example exactly).
    const subtotal = taxInclusive
      ? parseFloat((rawSubtotal - tax_amount).toFixed(2))
      : rawSubtotal;

    return { items, subtotal, discount_amount, tax_amount, total };
  }
}
