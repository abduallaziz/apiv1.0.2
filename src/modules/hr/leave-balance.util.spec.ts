import { calculateLeaveDays, leaveRangesOverlap } from './leave-balance.util';

describe('leave util', () => {
  it('detects overlap (inclusive)', () => {
    expect(
      leaveRangesOverlap(
        '2026-11-21',
        '2026-11-24',
        '2026-11-22',
        '2026-11-23',
      ),
    ).toBe(true);
    expect(
      leaveRangesOverlap(
        '2026-11-21',
        '2026-11-24',
        '2026-11-24',
        '2026-11-26',
      ),
    ).toBe(true);
    expect(
      leaveRangesOverlap(
        '2026-11-21',
        '2026-11-24',
        '2026-11-25',
        '2026-11-26',
      ),
    ).toBe(false);
  });
  it('counts days inclusively', () => {
    expect(calculateLeaveDays('2026-11-20', '2026-11-22')).toBe(3);
  });
});
