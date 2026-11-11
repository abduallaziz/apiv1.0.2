import { PosEngine } from './pos.engine';
import { DiscountEngine } from '../discount-engine/discount.engine';

// Tax Pricing Phase 1 (Owner-approved) — targeted unit tests for the
// inclusive-mode calculation added to PosEngine, plus an exclusive
// regression baseline proving existing behavior is untouched.
describe('PosEngine — tax pricing', () => {
  const engine = new PosEngine(new DiscountEngine());

  const items = (unitPrice: number, quantity = 1) => [
    {
      item_id: 'i1',
      item_name: 'Item',
      quantity,
      unit_price: unitPrice,
    },
  ];

  describe('exclusive mode (regression — untouched behavior)', () => {
    it('5.00 @ 15% -> tax 0.75, total 5.75', () => {
      const built = engine.buildInvoice(items(5.0), undefined, 0.15, false);
      expect(built.subtotal).toBe(5.0);
      expect(built.tax_amount).toBe(0.75);
      expect(built.total).toBe(5.75);
    });

    it('defaults to exclusive when taxInclusive is omitted', () => {
      const built = engine.buildInvoice(items(5.0), undefined, 0.15);
      expect(built.tax_amount).toBe(0.75);
      expect(built.total).toBe(5.75);
    });
  });

  describe('inclusive mode', () => {
    it('5.75 @ 15% -> base 5.00, tax 0.75, total 5.75', () => {
      const built = engine.buildInvoice(items(5.75), undefined, 0.15, true);
      expect(built.subtotal).toBe(5.0);
      expect(built.tax_amount).toBe(0.75);
      expect(built.total).toBe(5.75);
      // Critical reconciliation identity — must always hold exactly.
      expect(
        parseFloat((built.subtotal + built.tax_amount).toFixed(2)),
      ).toBe(built.total);
    });

    it('5.75 @ 0% -> base 5.75, tax 0, total 5.75', () => {
      const built = engine.buildInvoice(items(5.75), undefined, 0, true);
      expect(built.subtotal).toBe(5.75);
      expect(built.tax_amount).toBe(0);
      expect(built.total).toBe(5.75);
    });

    it('multiple inclusive items', () => {
      const twoItems = [
        { item_id: 'i1', item_name: 'A', quantity: 1, unit_price: 5.75 },
        { item_id: 'i2', item_name: 'B', quantity: 1, unit_price: 20 },
      ];
      const built = engine.buildInvoice(twoItems, undefined, 0.15, true);
      expect(built.total).toBe(25.75);
      expect(
        parseFloat((built.subtotal + built.tax_amount).toFixed(2)),
      ).toBe(built.total);
    });

    it('inclusive + discount reconciles against the accounting engine\'s invariant', () => {
      const built = engine.buildInvoice(
        items(25.75),
        { type: 'percentage', value: 10 },
        0.15,
        true,
      );
      expect(built.total).toBe(23.17);
      // subtotal is PRE-discount (required by fn_post_sales_order's
      // unconditional subtotal - discount + tax = total check) — NOT
      // subtotal + tax = total, which only holds when discount is 0.
      expect(
        parseFloat(
          (built.subtotal - built.discount_amount + built.tax_amount).toFixed(2),
        ),
      ).toBe(built.total);
    });
  });

  describe('applyTax / calculateTotal directly (used by the combined-discount path)', () => {
    it('inclusive: tax derived by subtraction, never independent rounding', () => {
      const tax = engine.applyTax(5.75, 0, 0.15, true);
      expect(tax).toBe(0.75);
      const total = engine.calculateTotal(5.75, 0, tax, true);
      expect(total).toBe(5.75);
    });
  });
});
