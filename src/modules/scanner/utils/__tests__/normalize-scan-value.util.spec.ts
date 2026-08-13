import { normalizeScanValue } from '../normalize-scan-value.util';

describe('normalizeScanValue', () => {
  it('trims leading and trailing whitespace', () => {
    expect(normalizeScanValue('  12345  ')).toBe('12345');
  });

  it('collapses internal whitespace runs to a single space', () => {
    expect(normalizeScanValue('AB   CD\t\tEF')).toBe('AB CD EF');
  });

  it('uppercases the value', () => {
    expect(normalizeScanValue('abc-123-def')).toBe('ABC-123-DEF');
  });

  it('leaves an already-clean numeric barcode unchanged in content', () => {
    expect(normalizeScanValue('1234567890128')).toBe('1234567890128');
  });

  it('never mutates the caller-supplied string', () => {
    const original = ' abc ';
    normalizeScanValue(original);
    expect(original).toBe(' abc ');
  });
});
