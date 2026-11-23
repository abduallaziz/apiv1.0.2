import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { MetricsService } from '../metrics/metrics.service';

/**
 * R-UNPOOLED guard.
 *
 * The non-pooled sale path (POOLED_INVOICE_WRITES_ENABLED false) saves the
 * sale WITHOUT any accounting entry; with pooled writes on but
 * POOLED_STOCK_IN_TX_ENABLED off the entry is posted without COGS; without
 * DATABASE_URL the pooled path cannot work at all. In production none of
 * these states should be silent.
 *
 * Default behaviour (REQUIRE_POOLED_SALES absent/false): log CRITICAL + set the
 * Prometheus gauge, change nothing else. REQUIRE_POOLED_SALES=true makes the
 * app refuse to boot in such a state (and the sale path refuse a non-pooled
 * sale, see InvoicesService.create).
 */

export type PooledSalesViolation =
  | 'database_url_missing'
  | 'pooled_writes_off'
  | 'stock_in_tx_off';

export const POOLED_SALES_VIOLATIONS: readonly PooledSalesViolation[] = [
  'database_url_missing',
  'pooled_writes_off',
  'stock_in_tx_off',
];

type EnvLike = Record<string, unknown>;

/** Same truthiness Joi.boolean() applies to env strings ('true'/'false', case-insensitive). */
export function envFlag(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
  return false;
}

export function isProductionEnv(env: EnvLike): boolean {
  return env.NODE_ENV === 'production';
}

/** Pure: which risky states does this environment describe? Empty outside production. */
export function evaluatePooledSalesState(env: EnvLike): PooledSalesViolation[] {
  if (!isProductionEnv(env)) return [];
  const out: PooledSalesViolation[] = [];
  const dbUrl = typeof env.DATABASE_URL === 'string' ? env.DATABASE_URL.trim() : '';
  const pooled = envFlag(env.POOLED_INVOICE_WRITES_ENABLED);
  if (!dbUrl) out.push('database_url_missing');
  if (!pooled) out.push('pooled_writes_off');
  else if (!envFlag(env.POOLED_STOCK_IN_TX_ENABLED)) out.push('stock_in_tx_off');
  return out;
}

export function isPooledSalesRequired(env: EnvLike): boolean {
  return envFlag(env.REQUIRE_POOLED_SALES);
}

const MESSAGES: Record<PooledSalesViolation, string> = {
  database_url_missing:
    'DATABASE_URL is missing: the pooled (transactional) write path cannot work',
  pooled_writes_off:
    'POOLED_INVOICE_WRITES_ENABLED is not true: sales are saved WITHOUT an accounting entry',
  stock_in_tx_off:
    'POOLED_STOCK_IN_TX_ENABLED is not true while pooled writes are on: sales post revenue without COGS',
};

export function describePooledSalesViolations(
  violations: readonly PooledSalesViolation[],
): string[] {
  return violations.map((v) => MESSAGES[v]);
}

@Injectable()
export class PooledSalesGuardService implements OnModuleInit {
  private readonly logger = new Logger(PooledSalesGuardService.name);

  constructor(@Optional() private readonly metrics?: MetricsService) {}

  onModuleInit(): void {
    this.check(process.env);
  }

  /** Exposed for tests: logs, sets the gauge, throws only when required. */
  check(env: EnvLike): PooledSalesViolation[] {
    const violations = evaluatePooledSalesState(env);
    this.metrics?.setPooledSalesGuard(violations);
    for (const msg of describePooledSalesViolations(violations)) {
      this.logger.error(`CRITICAL R-UNPOOLED: ${msg}`);
    }
    if (violations.length > 0 && isPooledSalesRequired(env)) {
      throw new Error(
        `REQUIRE_POOLED_SALES=true and the environment is unsafe (${violations.join(', ')}); refusing to start`,
      );
    }
    return violations;
  }
}
