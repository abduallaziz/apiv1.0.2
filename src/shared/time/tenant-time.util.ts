// Phase 1 of the register/daily-close design (owner approved 2026-11-09):
// day boundaries for reports and the dashboard must follow the tenant's
// timezone (tenants.timezone, default Asia/Riyadh), not UTC. A sale at
// 00:45 local (UTC+3) is 21:45 UTC of the previous day and used to be
// counted on the previous day.

export const DEFAULT_TENANT_TIMEZONE = 'Asia/Riyadh';

export function safeTimezone(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_TENANT_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TENANT_TIMEZONE;
  }
}

// Offset in ms of `tz` from UTC at the UTC instant `utcMs` (positive east).
function tzOffsetMs(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

// The UTC instant (ISO string) of local wall-clock `YYYY-MM-DD` start
// (00:00:00.000) or end (23:59:59.999) in `tz`.
export function localDayBoundIso(
  dateStr: string,
  bound: 'start' | 'end',
  tz: string,
): string {
  const zone = safeTimezone(tz);
  const [y, m, d] = dateStr.split('-').map(Number);
  const wall =
    bound === 'start'
      ? Date.UTC(y, m - 1, d, 0, 0, 0, 0)
      : Date.UTC(y, m - 1, d, 23, 59, 59, 999);
  let utc = wall - tzOffsetMs(wall, zone);
  utc = wall - tzOffsetMs(utc, zone);
  return new Date(utc).toISOString();
}

// 'YYYY-MM-DD' of the instant `iso` as seen in `tz`.
export function localDateOf(iso: string | Date, tz: string): string {
  const zone = safeTimezone(tz);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(typeof iso === 'string' ? new Date(iso) : iso);
}

// Start (UTC ISO) of "today" in `tz`.
export function startOfLocalToday(tz: string, now = new Date()): string {
  return localDayBoundIso(localDateOf(now, tz), 'start', tz);
}
