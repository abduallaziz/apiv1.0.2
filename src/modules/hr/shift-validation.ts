import { BadRequestException } from '@nestjs/common';

const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

/**
 * start must differ from end. end < start is an intentional overnight shift (end = next day).
 * Shifts of the same day must not overlap each other.
 * Returns an error message or null.
 */
export function findShiftsError(
  shifts: { start_time: string; end_time: string }[] | undefined | null,
): string | null {
  if (!shifts || shifts.length === 0) return null;
  const spans: [number, number][] = [];
  for (const s of shifts) {
    const start = toMin(s.start_time);
    let end = toMin(s.end_time);
    if (start === end) return 'Shift start and end times must be different';
    if (end < start) end += 24 * 60; // overnight
    spans.push([start, end]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < spans.length; i++) {
    if (spans[i][0] < spans[i - 1][1]) return 'Shifts must not overlap';
  }
  return null;
}

export function assertValidShifts(
  shifts: { start_time: string; end_time: string }[] | undefined | null,
) {
  const err = findShiftsError(shifts);
  if (err) throw new BadRequestException(err);
}
