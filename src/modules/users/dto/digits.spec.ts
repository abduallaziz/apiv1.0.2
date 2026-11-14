import { normalizePhone, toWesternDigits } from './digits';

describe('digits', () => {
  it('converts Arabic-Indic digits', () => {
    expect(toWesternDigits('٠٥٥٥١٢٣٤٥٦٧')).toBe('05551234567');
  });
  it('normalizes phone spacing', () => {
    expect(normalizePhone(' ٠٥٥ 123-4567 ')).toBe('0551234567');
  });
});
