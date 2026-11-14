import { isAbsence, isDayEvaluable } from './payroll.util';

describe('payroll util', () => {
  const today = '2026-11-14';
  it('future days are never evaluated nor absences', () => {
    expect(isDayEvaluable('2026-11-20', today, false)).toBe(false);
    expect(
      isAbsence({ scheduledDate: '2026-11-20', today, hasAttendance: false, onLeave: false, excused: false }),
    ).toBe(false);
  });
  it('today without attendance is not yet an absence', () => {
    expect(isDayEvaluable(today, today, false)).toBe(false);
    expect(isDayEvaluable(today, today, true)).toBe(true);
    expect(
      isAbsence({ scheduledDate: today, today, hasAttendance: false, onLeave: false, excused: false }),
    ).toBe(false);
  });
  it('past day with no attendance/leave/exemption is an absence', () => {
    expect(
      isAbsence({ scheduledDate: '2026-11-03', today, hasAttendance: false, onLeave: false, excused: false }),
    ).toBe(true);
  });
  it('past day with attendance, leave or exemption is not', () => {
    const base = { scheduledDate: '2026-11-03', today };
    expect(isAbsence({ ...base, hasAttendance: true, onLeave: false, excused: false })).toBe(false);
    expect(isAbsence({ ...base, hasAttendance: false, onLeave: true, excused: false })).toBe(false);
    expect(isAbsence({ ...base, hasAttendance: false, onLeave: false, excused: true })).toBe(false);
  });
});
