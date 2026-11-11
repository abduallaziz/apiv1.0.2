-- 258_billing_payment_idempotency.sql   (PENDING — not applied, not yet verified on a database)
-- P0/T3: DB-level protection against double charging and duplicate Stripe webhook processing.
-- Additive and idempotent. Aborts (never deletes) if existing data would violate a new unique index.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM payments WHERE status = 'succeeded'
    GROUP BY invoice_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION '258 preflight: some invoices already have more than one succeeded payment — resolve manually first';
  END IF;
  IF EXISTS (
    SELECT 1 FROM payments WHERE provider_payment_id IS NOT NULL
    GROUP BY provider, provider_payment_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION '258 preflight: duplicate (provider, provider_payment_id) rows exist — resolve manually first';
  END IF;
END $$;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_one_succeeded_per_invoice
  ON payments (invoice_id) WHERE status = 'succeeded';

CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_provider_payment
  ON payments (provider, provider_payment_id) WHERE provider_payment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_idempotency
  ON payments (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Platform-level (not tenant-scoped, immutable log): intentionally no tenant_id / deleted_at.
CREATE TABLE IF NOT EXISTS billing_webhook_events (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider      TEXT        NOT NULL,
  event_id      TEXT        NOT NULL,
  event_type    TEXT        NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'received'
                            CHECK (status IN ('received', 'processed', 'failed', 'ignored')),
  payload_hash  TEXT,
  error         TEXT,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at  TIMESTAMPTZ,
  UNIQUE (provider, event_id)
);

GRANT ALL PRIVILEGES ON public.billing_webhook_events TO service_role;

-- ROLLBACK (manual):
--   DROP INDEX IF EXISTS uq_payments_one_succeeded_per_invoice, uq_payments_provider_payment, uq_payments_idempotency;
--   DROP TABLE IF EXISTS billing_webhook_events;
--   ALTER TABLE payments DROP COLUMN IF EXISTS idempotency_key;
