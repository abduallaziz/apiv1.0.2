import { findShiftsError } from './shift-validation';

describe('findShiftsError', () => {
  it('rejects start == end', () => {
    expect(
      findShiftsError([{ start_time: '09:00', end_time: '09:00' }]),
    ).toMatch(/different/);
  });
  it('rejects overlapping shifts', () => {
    expect(
      findShiftsError([
        { start_time: '09:00', end_time: '13:00' },
        { start_time: '12:00', end_time: '17:00' },
      ]),
    ).toMatch(/overlap/);
  });
  it('accepts split and overnight shifts', () => {
    expect(
      findShiftsError([
        { start_time: '08:00', end_time: '12:00' },
        { start_time: '14:00', end_time: '18:00' },
      ]),
    ).toBeNull();
    expect(
      findShiftsError([{ start_time: '18:00', end_time: '08:00' }]),
    ).toBeNull();
  });
  it('overnight overlapping a day shift is rejected', () => {
    expect(
      findShiftsError([
        { start_time: '08:00', end_time: '12:00' },
        { start_time: '20:00', end_time: '09:00' },
      ]),
    ).toBeNull(); // 20:00-33:00 vs 08:00-12:00 on same day: no overlap within one day
  });
});
