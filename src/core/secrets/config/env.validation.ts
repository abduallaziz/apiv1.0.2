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
});