import {
  localDayBoundIso,
  localDateOf,
  startOfLocalToday,
  safeTimezone,
  DEFAULT_TENANT_TIMEZONE,
} from './tenant-time.util';

describe('tenant-time.util (Asia/Riyadh = UTC+3, no DST)', () => {
  const tz = 'Asia/Riyadh';

  it('start of 2026-11-09 local is 2026-11-08T21:00:00.000Z', () => {
    expect(localDayBoundIso('2026-11-09', 'start', tz)).toBe(
      '2026-11-08T21:00:00.000Z',
    );
  });

  it('end of 2026-11-09 local is 2026-11-09T20:59:59.999Z', () => {
    expect(localDayBoundIso('2026-11-09', 'end', tz)).toBe(
      '2026-11-09T20:59:59.999Z',
    );
  });

  it('a sale at 00:45 local (21:45Z previous day) belongs to the local day', () => {
    expect(localDateOf('2026-11-08T21:45:00.000Z', tz)).toBe('2026-11-09');
  });

  it('a sale at 23:30 local (20:30Z) still belongs to the same local day', () => {
    expect(localDateOf('2026-11-09T20:30:00.000Z', tz)).toBe('2026-11-09');
  });

  it('startOfLocalToday uses the local date, not the UTC date', () => {
    const now = new Date('2026-11-08T22:11:00.000Z'); // 01:11 on Nov 9 local
    expect(startOfLocalToday(tz, now)).toBe('2026-11-08T21:00:00.000Z');
  });

  it('UTC tenant keeps UTC boundaries', () => {
    expect(localDayBoundIso('2026-11-09', 'start', 'UTC')).toBe(
      '2026-11-09T00:00:00.000Z',
    );
  });

  it('invalid or missing timezone falls back to the default', () => {
    expect(safeTimezone('Not/AZone')).toBe(DEFAULT_TENANT_TIMEZONE);
    expect(safeTimezone(null)).toBe(DEFAULT_TENANT_TIMEZONE);
  });
});
