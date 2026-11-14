/** Inclusive date ranges (YYYY-MM-DD) overlap. */
export function leaveRangesOverlap(
  aFrom: string,
  aTo: string,
  bFrom: string,
  bTo: string,
): boolean {
  return aFrom <= bTo && bFrom <= aTo;
}

export function calculateLeaveDays(dateFrom: string, dateTo: string): number {
  return (
    Math.round(
      (new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86400000,
    ) + 1
  );
}
