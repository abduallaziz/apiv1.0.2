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
  // Deduct sale stock INSIDE the pooled invoice transaction, before the
  // sales journal entry is posted, so the entry sees the inventory cost and
  // posts Dr COGS / Cr Inventory (see docs/DESIGN_COGS_POSTING_AFTER_STOCK_DEDUCTION.md).
  // Only meaningful with POOLED_INVOICE_WRITES_ENABLED=true. A stock failure
  // never fails the sale (SAVEPOINT), it only falls back to the old behaviour.
  POOLED_STOCK_IN_TX_ENABLED: Joi.boolean().default(false),
  // ZATCA e-invoicing phase 2: issue a signed document inside every pooled sale of a branch that has
  // an onboarded device (docs/DESIGN_ZATCA_PHASE2.md). Off by default; nothing is sent to ZATCA here —
  // documents are prepared, signed, chained and stored until the connection is added.
  ZATCA_ENABLED: Joi.boolean().default(false),
  // 'fatoora' = really send to ZATCA (onboarding + reporting); 'null' = documents wait as pending.
  ZATCA_GATEWAY: Joi.string().valid('null', 'fatoora').default('null'),
  // 32-byte master key (base64 or 64 hex chars) encrypting the device private keys and CSID secrets.
  // Required when ZATCA_ENABLED=true or device keys are generated. Never log it.
  ZATCA_KEY_ENC_KEY: Joi.string().min(32).optional().allow(''),
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
  // The mock provider "succeeds" every charge without collecting money. In
  // production it is refused unless explicitly opted into (and logged) —
  // otherwise a misconfigured deploy would hand out paid plans for free.
  PAYMENT_PROVIDER: Joi.string().valid('stripe', 'mock').default('mock'),
  ALLOW_QA_EXEMPTION_IN_PRODUCTION: Joi.string().valid('true', 'false').optional(),
  ALLOW_MOCK_PAYMENT_IN_PRODUCTION: Joi.string().valid('true', 'false').optional(),
  STRIPE_SECRET_KEY: Joi.when('PAYMENT_PROVIDER', {
    is: 'stripe',
    then: Joi.string().pattern(/^sk_/).required(),
    otherwise: Joi.string().optional().allow(''),
  }),
  STRIPE_WEBHOOK_SECRET: Joi.when('PAYMENT_PROVIDER', {
    is: 'stripe',
    then: Joi.string()
      .pattern(/^whsec_/)
      .required(),
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

  // ── Load testing (temporary) ─────────────────────────
  // Bypasses every rate limit so a k6 run measures the application's ceiling
  // instead of the throttler's 429 rate. See core/security/load-test-mode.ts.
  //
  // Declared as a string, not Joi.boolean(), on purpose: Joi.boolean() would
  // coerce 'yes'/'1'/'TRUE' to true, whereas isLoadTestMode() requires the
  // exact string 'true'. Matching that strictness here keeps the schema
  // honest about what actually enables the flag, so a value that looks
  // enabling but is not fails validation at boot rather than silently leaving
  // limits active when the operator believes they are off.
  //
  // Remove this entry once load testing is complete.
  LOAD_TEST_MODE: Joi.string().valid('true', 'false').default('false'),
}).custom((value, helpers) => {
  // The mock provider "succeeds" every charge without collecting money. In
  // production it is refused unless explicitly opted into — otherwise a
  // misconfigured deploy would hand out paid plans for free. (Object-level so
  // the default 'mock' is also caught.)
  if (
    value.NODE_ENV === 'production' &&
    value.PAYMENT_PROVIDER === 'mock' &&
    value.ALLOW_MOCK_PAYMENT_IN_PRODUCTION !== 'true'
  ) {
    return helpers.message({
      custom:
        'PAYMENT_PROVIDER must be "stripe" in production (set ALLOW_MOCK_PAYMENT_IN_PRODUCTION=true only to knowingly accept free plans)',
    });
  }
  return value;
});
