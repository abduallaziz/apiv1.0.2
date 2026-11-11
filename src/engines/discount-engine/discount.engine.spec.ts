import { DiscountEngine } from './discount.engine';

describe('DiscountEngine bounds (P1)', () => {
  const e = new DiscountEngine();
  it('percentage is capped at 100% of the subtotal', () => {
    expect(e.applyPercentageDiscount(200, 150)).toBe(200);
    expect(e.applyPercentageDiscount(200, 10)).toBe(20);
  });
  it('negative percentage / fixed never act as a surcharge', () => {
    expect(e.applyPercentageDiscount(200, -50)).toBe(0);
    expect(e.applyFixedDiscount(200, -30)).toBe(0);
  });
  it('fixed is capped at the subtotal', () => {
    expect(e.applyFixedDiscount(100, 500)).toBe(100);
    expect(e.applyFixedDiscount(100, 25.5)).toBe(25.5);
  });
});
