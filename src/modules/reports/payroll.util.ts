// Pure helpers for the payroll computation (kept separate so they are unit-testable).

/**
 * Whether a scheduled day should be evaluated for absence/lateness/leave yet.
 * Future days never count. Today counts only if the employee already checked in
 * (an absence cannot be decided before the day is over).
 */
export function isDayEvaluable(
  scheduledDate: string,
  today: string,
  hasAttendance: boolean,
): boolean {
  if (scheduledDate > today) return false;
  if (scheduledDate === today && !hasAttendance) return false;
  return true;
}

/**
 * An absence = a scheduled, already-elapsed day with no attendance, no leave and no exemption.
 */
export function isAbsence(params: {
  scheduledDate: string;
  today: string;
  hasAttendance: boolean;
  onLeave: boolean;
  excused: boolean;
}): boolean {
  const { scheduledDate, today, hasAttendance, onLeave, excused } = params;
  if (hasAttendance || onLeave || excused) return false;
  return scheduledDate < today;
}
