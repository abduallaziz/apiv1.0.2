import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  // ── App ──────────────────────────────────────────────
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3001),

  // ── Database ─────────────────────────────────────────
  SUPABASE_URL: Joi.string().uri().required(),
  SUPABASE_SERVICE_ROLE_KEY: Joi.string().min(32).required(),

  // ── Direct Postgres (Supavisor transaction mode) ──────
  // Optional on purpose — not yet provisioned in any environment (see
  // STATUS.md §78/§79). PgPoolModule degrades to a disabled pool, not a boot
  // crash, when this is absent.
  DATABASE_URL: Joi.string().uri().optional().allow(''),
  PG_POOL_MAX: Joi.number().min(1).default(10),
  // Kill switch for the pooled/RLS-enforced invoice write path. Must stay
  // 'false' until DATABASE_URL is live and migration 075 has been applied —
  // flipping this without both crashes every invoice creation, not just the
  // migrated path, since there's no PostgREST fallback wired for this flag.
  POOLED_INVOICE_WRITES_ENABLED: Joi.boolean().default(false),
  // Same pattern, for StockRepository.callApplyStockMovementPooled — requires
  // DATABASE_URL live and migration 076 applied before enabling.
  POOLED_STOCK_WRITES_ENABLED: Joi.boolean().default(false),
  // Same pattern, for LoyaltyService's *Pooled methods — requires DATABASE_URL
  // live AND a dedicated non-BYPASSRLS Postgres role backing it (see the
  // caveat in loyalty.service.ts) before this actually enforces anything.
  POOLED_LOYALTY_WRITES_ENABLED: Joi.boolean().default(false),

  // ── Auth ─────────────────────────────────────────────
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRY: Joi.string().default('7d'),

  // ── Redis ─────────────────────────────────────────────
  REDIS_URL: Joi.string().uri().required(),

  // ── Stripe ───────────────────────────────────────────
  PAYMENT_PROVIDER: Joi.string().valid('stripe', 'mock').default('mock'),
  STRIPE_SECRET_KEY: Joi.when('PAYMENT_PROVIDER', {
    is: 'stripe',
    then: Joi.string().pattern(/^sk_/).required(),
    otherwise: Joi.string().optional().allow(''),
  }),
  STRIPE_WEBHOOK_SECRET: Joi.when('PAYMENT_PROVIDER', {
    is: 'stripe',
    then: Joi.string().pattern(/^whsec_/).required(),
    otherwise: Joi.string().optional().allow(''),
  }),

  // ── Email ────────────────────────────────────────────
  RESEND_API_KEY: Joi.string().optional().allow(''),
  EMAIL_FROM: Joi.string().email().default('noreply@sefay.com'),

  // ── Frontend ─────────────────────────────────────────
  FRONTEND_URL: Joi.string().uri().default('http://localhost:3000'),

  // ── Inventory ────────────────────────────────────────
  // Minimum |quantity_delta| * unit_cost (or |quantity_delta| when unit_cost
  // is omitted) above which a stock adjustment requires manager approval
  // before it can be posted. 0 disables the approval workflow entirely.
  INVENTORY_ADJUSTMENT_APPROVAL_THRESHOLD: Joi.number().min(0).default(0),
});