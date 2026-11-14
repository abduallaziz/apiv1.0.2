import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  assertNoConflict,
  assertNotInPast,
  assertPartyFits,
  canChangeStatus,
  conflictWindow,
} from './reservation-rules';

describe('reservation rules', () => {
  const now = new Date('2026-11-14T12:00:00Z').getTime();
  it('rejects past times, accepts future and grace', () => {
    expect(() => assertNotInPast('2026-11-10T20:00:00Z', now)).toThrow(
      BadRequestException,
    );
    expect(() => assertNotInPast('2026-11-14T11:58:00Z', now)).not.toThrow();
    expect(() => assertNotInPast('2026-11-20T20:00:00Z', now)).not.toThrow();
    expect(() => assertNotInPast('garbage', now)).toThrow(BadRequestException);
  });
  it('checks party vs capacity', () => {
    expect(() => assertPartyFits(500, 2)).toThrow(BadRequestException);
    expect(() => assertPartyFits(2, 2)).not.toThrow();
    expect(() => assertPartyFits(undefined, 2)).not.toThrow();
  });
  it('status transitions', () => {
    expect(canChangeStatus('confirmed', 'seated')).toBe(true);
    expect(canChangeStatus('seated', 'cancelled')).toBe(false);
    expect(canChangeStatus('cancelled', 'confirmed')).toBe(true);
    expect(canChangeStatus('cancelled', 'cancelled')).toBe(true);
  });
  it('conflict window is symmetric', () => {
    const w = conflictWindow('2026-11-20T20:00:00.000Z');
    expect(new Date(w.from).getTime()).toBeLessThan(
      new Date('2026-11-20T18:01:00Z').getTime(),
    );
    expect(() => assertNoConflict(1)).toThrow(ConflictException);
    expect(() => assertNoConflict(0)).not.toThrow();
  });
});
