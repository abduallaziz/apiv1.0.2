export function calculateLeaveDays(dateFrom: string, dateTo: string): number {
  return Math.round((new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86400000) + 1;
}
