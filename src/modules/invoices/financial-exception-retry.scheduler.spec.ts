/* eslint-disable @typescript-eslint/no-explicit-any */
import { FinancialExceptionRetryScheduler } from './financial-exception-retry.scheduler';

describe('FinancialExceptionRetryScheduler (WP-E)', () => {
  function build(
    settings: Record<string, unknown>,
    opts: { tenants?: string[]; failFor?: string[]; selectError?: boolean } = {},
  ) {
    const rpc = jest.fn((_fn: string, args: { p_tenant_id: string }) =>
      Promise.resolve(
        opts.failFor?.includes(args.p_tenant_id)
          ? { data: null, error: { message: 'boom' } }
          : { data: [{ status: 'resolved' }, { status: 'failed' }], error: null },
      ),
    );
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: jest.fn(() =>
        Promise.resolve(
          opts.selectError
            ? { data: null, error: { message: 'select failed' } }
            : { data: (opts.tenants ?? []).flatMap((t) => [{ tenant_id: t }, { tenant_id: t }]), error: null },
        ),
      ),
    };
    const supabase = { from: jest.fn(() => chain), rpc };
    const metrics = { recordFinancialExceptionRetry: jest.fn() };
    const config = { get: (k: string) => settings[k] };
    const s = new FinancialExceptionRetryScheduler(supabase as never, config as never, metrics as never);
    return { s, rpc, supabase, metrics, chain };
  }

  it('does nothing unless SALE_EXCEPTION_RECORDING_ENABLED is true (default)', async () => {
    const { s, supabase, rpc } = build({}, { tenants: ['t1'] });
    await s.runBatch();
    expect(supabase.from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('enabled: one bounded batch call per distinct tenant, metrics per outcome', async () => {
    const { s, rpc, metrics, chain } = build(
      { SALE_EXCEPTION_RECORDING_ENABLED: 'true', SALE_EXCEPTION_RETRY_BATCH_SIZE: 10, SALE_EXCEPTION_RETRY_MAX_TENANTS: 5 },
      { tenants: ['t1', 't2'] },
    );
    await s.runBatch();
    expect(chain.limit).toHaveBeenCalledWith(50);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith('fn_financial_exception_retry_batch', { p_limit: 10, p_tenant_id: 't1' });
    expect(metrics.recordFinancialExceptionRetry).toHaveBeenCalledWith('resolved', 1);
    expect(metrics.recordFinancialExceptionRetry).toHaveBeenCalledWith('failed', 1);
  });

  it('caps the number of tenants per run and clamps the batch size', async () => {
    const { s, rpc } = build(
      { SALE_EXCEPTION_RECORDING_ENABLED: true, SALE_EXCEPTION_RETRY_BATCH_SIZE: 100000, SALE_EXCEPTION_RETRY_MAX_TENANTS: 2 },
      { tenants: ['a', 'b', 'c', 'd'] },
    );
    await s.runBatch();
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_limit: 500 });
  });

  it('per-tenant isolation: one tenant failing does not stop the others, never throws', async () => {
    const { s, rpc, metrics } = build({ SALE_EXCEPTION_RECORDING_ENABLED: true }, { tenants: ['t1', 't2', 't3'], failFor: ['t2'] });
    await expect(s.runBatch()).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(metrics.recordFinancialExceptionRetry).toHaveBeenCalledWith('error', 1);
  });

  it('a failing tenant lookup is swallowed and counted; the next run still works (no stuck lock)', async () => {
    const { s, metrics } = build({ SALE_EXCEPTION_RECORDING_ENABLED: true }, { selectError: true });
    await expect(s.runBatch()).resolves.toBeUndefined();
    expect(metrics.recordFinancialExceptionRetry).toHaveBeenCalledWith('error', 1);
    await expect(s.runBatch()).resolves.toBeUndefined();
    expect(metrics.recordFinancialExceptionRetry).toHaveBeenCalledTimes(2);
  });
});
