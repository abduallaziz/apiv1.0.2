import { ConfigService } from '@nestjs/config';
import { FiscalCalendarService } from './fiscal-calendar.service';
import { FiscalCalendarScheduler } from './fiscal-calendar.scheduler';

type RpcResult = { data: unknown; error: { message: string } | null };

function build(
  opts: {
    tenants?: string[];
    rpc?: (fn: string, args: Record<string, unknown>) => RpcResult;
    settings?: Record<string, unknown>;
  } = {},
) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const supabase = {
    rpc: jest.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return opts.rpc ? opts.rpc(fn, args) : { data: [], error: null };
    }),
    from: jest.fn(() => ({
      select: jest.fn(async () => ({
        data: (opts.tenants ?? []).map((tenant_id) => ({ tenant_id })),
        error: null,
      })),
    })),
  };
  const config = {
    get: (k: string) => (opts.settings ?? {})[k],
  } as unknown as ConfigService;
  const metrics = { setFiscalCoverage: jest.fn() };
  const service = new FiscalCalendarService(
    supabase as never,
    config,
    metrics as never,
  );
  return { service, supabase, calls, metrics, config };
}

const create = (label: string) => ({
  seq: 1,
  action: 'create',
  year_label: label,
  start_date: `${label}-01-01`,
  end_date: `${Number(label) + 1}-01-01`,
  detail: '12 monthly periods, status open',
});

describe('FiscalCalendarService (WP-B)', () => {
  it('throughDate adds whole years in UTC', () => {
    expect(
      FiscalCalendarService.throughDate(new Date('2026-11-23T10:00:00Z'), 2),
    ).toBe('2028-11-23');
    expect(
      FiscalCalendarService.throughDate(new Date('2026-12-31T23:59:59Z'), 0),
    ).toBe('2026-12-31');
  });

  it('settings default to a 2-year horizon / 180-day alert and are clamped', () => {
    expect(build().service.getSettings()).toEqual({
      horizonYears: 2,
      alertDays: 180,
    });
    expect(
      build({
        settings: { FISCAL_HORIZON_YEARS: 99, FISCAL_ALERT_DAYS: 0 },
      }).service.getSettings(),
    ).toEqual({ horizonYears: 5, alertDays: 1 });
    expect(
      build({ settings: { FISCAL_HORIZON_YEARS: 'abc' } }).service.getSettings()
        .horizonYears,
    ).toBe(2);
  });

  it('dry-run (default) calls only the read-only plan function and never ensure', async () => {
    const { service, calls } = build({
      tenants: ['t1', 't2'],
      rpc: (fn) =>
        fn === 'fn_plan_fiscal_years'
          ? { data: [create('2027'), create('2028')], error: null }
          : { data: [], error: null },
    });
    const report = await service.runMaintenance({
      now: new Date('2026-11-23T00:00:00Z'),
    });
    expect(report.mode).toBe('dry-run');
    expect(report.through_date).toBe('2028-11-23');
    expect(report.tenants).toBe(2);
    expect(report.to_create_years).toBe(4);
    expect(report.to_create_periods).toBe(48);
    expect(report.created_years).toBe(0);
    expect(calls.some((c) => c.fn === 'fn_ensure_fiscal_years')).toBe(false);
  });

  it('apply calls ensure with dry_run=false per tenant and counts created years', async () => {
    const { service, calls } = build({
      tenants: ['t1'],
      rpc: (fn) =>
        fn === 'fn_ensure_fiscal_years'
          ? {
              data: [
                { ...create('2027'), created: true },
                { ...create('2028'), created: true },
              ],
              error: null,
            }
          : { data: [], error: null },
    });
    const report = await service.runMaintenance({
      apply: true,
      now: new Date('2026-11-23T00:00:00Z'),
    });
    expect(report.mode).toBe('apply');
    expect(report.created_years).toBe(2);
    const ensure = calls.filter((c) => c.fn === 'fn_ensure_fiscal_years');
    expect(ensure).toHaveLength(1);
    expect(ensure[0].args).toMatchObject({
      p_tenant_id: 't1',
      p_dry_run: false,
    });
  });

  it('a failure for one tenant never stops the others and is reported', async () => {
    const { service } = build({
      tenants: ['bad', 'good'],
      rpc: (fn, args) =>
        fn === 'fn_plan_fiscal_years' && args.p_tenant_id === 'bad'
          ? { data: null, error: { message: 'boom' } }
          : { data: [create('2027')], error: null },
    });
    const report = await service.runMaintenance({
      now: new Date('2026-11-23T00:00:00Z'),
    });
    expect(report.errors).toBe(1);
    expect(report.per_tenant.find((t) => t.tenant_id === 'bad')?.error).toBe(
      'boom',
    );
    expect(
      report.per_tenant.find((t) => t.tenant_id === 'good')?.rows,
    ).toHaveLength(1);
    expect(report.to_create_years).toBe(1);
  });

  it('refusals are counted (never swallowed) and exposed in the report', async () => {
    const { service } = build({
      tenants: ['t1'],
      rpc: () => ({
        data: [
          {
            seq: 1,
            action: 'refuse',
            year_label: null,
            start_date: null,
            end_date: null,
            detail: 'gap',
          },
        ],
        error: null,
      }),
    });
    const report = await service.runMaintenance({});
    expect(report.refused).toBe(1);
    expect(report.to_create_years).toBe(0);
  });

  it('publishes aggregate coverage gauges (no tenant labels) from the alert list', async () => {
    const { service, metrics } = build({
      tenants: [],
      rpc: (fn) =>
        fn === 'fn_fiscal_coverage_alerts'
          ? {
              data: [
                {
                  tenant_id: 'a',
                  covered_until: '2026-12-31',
                  days_remaining: 38,
                  severity: 'high',
                },
                {
                  tenant_id: 'b',
                  covered_until: '2026-12-10',
                  days_remaining: 17,
                  severity: 'critical',
                },
              ],
              error: null,
            }
          : { data: [], error: null },
    });
    const report = await service.runMaintenance({});
    expect(report.alerts).toHaveLength(2);
    expect(metrics.setFiscalCoverage).toHaveBeenCalledWith(17, 2);
  });

  it('with no alerts the gauge reports the alert threshold itself (healthy)', async () => {
    const { service, metrics } = build({ tenants: [] });
    await service.runMaintenance({});
    expect(metrics.setFiscalCoverage).toHaveBeenCalledWith(180, 0);
  });
});

describe('FiscalCalendarScheduler (WP-B)', () => {
  function sched(settings: Record<string, unknown>) {
    const fiscal = {
      runMaintenance: jest.fn().mockResolvedValue({
        mode: 'dry-run',
        tenants: 0,
        to_create_years: 0,
        created_years: 0,
        refused: 0,
        errors: 0,
        alerts: [],
      }),
    };
    const config = {
      get: (k: string) => settings[k],
    } as unknown as ConfigService;
    return {
      scheduler: new FiscalCalendarScheduler(fiscal as never, config),
      fiscal,
    };
  }

  it('does nothing when FISCAL_SCHEDULER_ENABLED is not true (default)', async () => {
    const { scheduler, fiscal } = sched({});
    await scheduler.runDaily();
    expect(fiscal.runMaintenance).not.toHaveBeenCalled();
  });

  it('enabled but not APPLY: reports only (dry-run)', async () => {
    const { scheduler, fiscal } = sched({ FISCAL_SCHEDULER_ENABLED: 'true' });
    await scheduler.runDaily();
    expect(fiscal.runMaintenance).toHaveBeenCalledWith({ apply: false });
  });

  it('applies only when BOTH flags are true', async () => {
    const { scheduler, fiscal } = sched({
      FISCAL_SCHEDULER_ENABLED: true,
      FISCAL_SCHEDULER_APPLY: 'true',
    });
    await scheduler.runDaily();
    expect(fiscal.runMaintenance).toHaveBeenCalledWith({ apply: true });
  });

  it('never throws out of the cron callback', async () => {
    const { scheduler, fiscal } = sched({ FISCAL_SCHEDULER_ENABLED: true });
    fiscal.runMaintenance.mockRejectedValue(new Error('db down'));
    await expect(scheduler.runDaily()).resolves.toBeUndefined();
  });
});
