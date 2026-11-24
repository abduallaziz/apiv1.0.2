import {
  evaluatePooledSalesState,
  PooledSalesGuardService,
  PooledSalesViolation,
} from './pooled-sales-guard';
import { envValidationSchema } from '../secrets/config/env.validation';
import { MetricsService } from '../metrics/metrics.service';

const URL_OK = 'postgresql://u@127.0.0.1:6543/db';
const prod = (o: Record<string, unknown>) => ({ NODE_ENV: 'production', ...o });

describe('R-UNPOOLED evaluatePooledSalesState', () => {
  const cases: Array<[string, Record<string, unknown>, PooledSalesViolation[]]> = [
    ['prod, fully pooled', prod({ DATABASE_URL: URL_OK, POOLED_INVOICE_WRITES_ENABLED: 'true', POOLED_STOCK_IN_TX_ENABLED: 'true' }), []],
    ['prod, booleans as real booleans', prod({ DATABASE_URL: URL_OK, POOLED_INVOICE_WRITES_ENABLED: true, POOLED_STOCK_IN_TX_ENABLED: true }), []],
    ['prod, pooled writes off', prod({ DATABASE_URL: URL_OK, POOLED_INVOICE_WRITES_ENABLED: 'false', POOLED_STOCK_IN_TX_ENABLED: 'true' }), ['pooled_writes_off']],
    ['prod, pooled writes unset', prod({ DATABASE_URL: URL_OK }), ['pooled_writes_off']],
    ['prod, stock-in-tx off', prod({ DATABASE_URL: URL_OK, POOLED_INVOICE_WRITES_ENABLED: 'true', POOLED_STOCK_IN_TX_ENABLED: 'false' }), ['stock_in_tx_off']],
    ['prod, stock-in-tx unset', prod({ DATABASE_URL: URL_OK, POOLED_INVOICE_WRITES_ENABLED: 'true' }), ['stock_in_tx_off']],
    ['prod, DATABASE_URL missing', prod({ POOLED_INVOICE_WRITES_ENABLED: 'true', POOLED_STOCK_IN_TX_ENABLED: 'true' }), ['database_url_missing']],
    ['prod, DATABASE_URL blank', prod({ DATABASE_URL: '  ', POOLED_INVOICE_WRITES_ENABLED: 'true', POOLED_STOCK_IN_TX_ENABLED: 'true' }), ['database_url_missing']],
    ['prod, everything missing', prod({}), ['database_url_missing', 'pooled_writes_off']],
    ['development, nothing set', { NODE_ENV: 'development' }, []],
    ['test, nothing set', { NODE_ENV: 'test' }, []],
    ['NODE_ENV unset', {}, []],
  ];
  it.each(cases)('%s', (_n, env, expected) => {
    expect(evaluatePooledSalesState(env)).toEqual(expected);
  });
});

describe('PooledSalesGuardService', () => {
  const unsafe = prod({ POOLED_INVOICE_WRITES_ENABLED: 'false' });
  const safe = prod({ DATABASE_URL: URL_OK, POOLED_INVOICE_WRITES_ENABLED: 'true', POOLED_STOCK_IN_TX_ENABLED: 'true' });
  const quiet = (svc: PooledSalesGuardService) =>
    jest.spyOn((svc as any).logger, 'error').mockImplementation();

  it('default (REQUIRE absent): unsafe prod only logs + sets gauge, does not throw', async () => {
    const metrics = new MetricsService();
    const svc = new PooledSalesGuardService(metrics);
    const err = quiet(svc);
    expect(() => svc.check(unsafe)).not.toThrow();
    expect(err).toHaveBeenCalledTimes(2);
    expect(err.mock.calls[0][0]).toContain('CRITICAL R-UNPOOLED');
    const text = await metrics.getMetrics();
    expect(text).toMatch(/sefay_pooled_sales_guard_violation\{reason="pooled_writes_off"[^}]*\} 1/);
    expect(text).toMatch(/sefay_pooled_sales_guard_violation\{reason="stock_in_tx_off"[^}]*\} 0/);
  });

  it('REQUIRE_POOLED_SALES=false behaves like absent', () => {
    const svc = new PooledSalesGuardService();
    quiet(svc);
    expect(() => svc.check({ ...unsafe, REQUIRE_POOLED_SALES: 'false' })).not.toThrow();
  });

  it('REQUIRE_POOLED_SALES=true: refuses to boot for each violation', () => {
    const svc = new PooledSalesGuardService();
    quiet(svc);
    for (const env of [
      prod({ DATABASE_URL: URL_OK, POOLED_INVOICE_WRITES_ENABLED: 'false' }),
      prod({ DATABASE_URL: URL_OK, POOLED_INVOICE_WRITES_ENABLED: 'true', POOLED_STOCK_IN_TX_ENABLED: 'false' }),
      prod({ POOLED_INVOICE_WRITES_ENABLED: 'true', POOLED_STOCK_IN_TX_ENABLED: 'true' }),
    ]) {
      expect(() => svc.check({ ...env, REQUIRE_POOLED_SALES: 'true' })).toThrow(/refusing to start/);
    }
  });

  it('REQUIRE_POOLED_SALES=true with the confirmed production flags boots, no log, gauge 0', async () => {
    const metrics = new MetricsService();
    const svc = new PooledSalesGuardService(metrics);
    const err = quiet(svc);
    expect(() => svc.check({ ...safe, REQUIRE_POOLED_SALES: 'true' })).not.toThrow();
    expect(err).not.toHaveBeenCalled();
    expect(await metrics.getMetrics()).toMatch(/reason="pooled_writes_off"[^}]*\} 0/);
  });

  it('REQUIRE_POOLED_SALES=true outside production never throws', () => {
    const svc = new PooledSalesGuardService();
    expect(() => svc.check({ NODE_ENV: 'development', REQUIRE_POOLED_SALES: 'true' })).not.toThrow();
  });
});

describe('REQUIRE_POOLED_SALES Joi validation', () => {
  const base = {
    SUPABASE_URL: 'https://abcdefghij1234567890.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'x'.repeat(40),
    JWT_SECRET: 'j'.repeat(40),
    REDIS_URL: 'redis://localhost:6379',
    PAYMENT_PROVIDER: 'stripe',
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_WEBHOOK_SECRET: 'whsec_x',
  };
  const v = (extra: Record<string, string>) =>
    envValidationSchema.validate({ ...base, ...extra }, { allowUnknown: true });

  it('absent: defaults false, production with unpooled flags still validates (backward compatible)', () => {
    const r = v({ NODE_ENV: 'production' });
    expect(r.error).toBeUndefined();
    expect(r.value.REQUIRE_POOLED_SALES).toBe(false);
  });
  it('confirmed production set (pooled+stock-in-tx, no new vars) validates', () => {
    expect(
      v({ NODE_ENV: 'production', DATABASE_URL: URL_OK, POOLED_INVOICE_WRITES_ENABLED: 'true', POOLED_STOCK_IN_TX_ENABLED: 'true' }).error,
    ).toBeUndefined();
  });
  it('true + unpooled production fails validation', () => {
    expect(v({ NODE_ENV: 'production', DATABASE_URL: URL_OK, REQUIRE_POOLED_SALES: 'true' }).error).toBeDefined();
  });
  it('true + stock-in-tx off fails validation', () => {
    expect(
      v({ NODE_ENV: 'production', DATABASE_URL: URL_OK, REQUIRE_POOLED_SALES: 'true', POOLED_INVOICE_WRITES_ENABLED: 'true' }).error,
    ).toBeDefined();
  });
  it('true + missing DATABASE_URL fails validation', () => {
    expect(
      v({ NODE_ENV: 'production', REQUIRE_POOLED_SALES: 'true', POOLED_INVOICE_WRITES_ENABLED: 'true', POOLED_STOCK_IN_TX_ENABLED: 'true' }).error,
    ).toBeDefined();
  });
  it('true + fully pooled production validates', () => {
    expect(
      v({ NODE_ENV: 'production', DATABASE_URL: URL_OK, REQUIRE_POOLED_SALES: 'true', POOLED_INVOICE_WRITES_ENABLED: 'true', POOLED_STOCK_IN_TX_ENABLED: 'true' }).error,
    ).toBeUndefined();
  });
  it('true + unpooled in development validates', () => {
    expect(v({ NODE_ENV: 'development', REQUIRE_POOLED_SALES: 'true' }).error).toBeUndefined();
  });
  it('rejects a non-boolean value', () => {
    expect(v({ REQUIRE_POOLED_SALES: 'maybe' }).error).toBeDefined();
  });
});
