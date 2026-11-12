-- 269_zatca_groundwork.sql
-- ZATCA e-invoicing phase 2 (Fatoora) — everything that does NOT need a connection to ZATCA:
-- the EGS device registry (per branch) and the store of generated/signed invoices with their
-- ICV counter and PIH hash chain. Connecting to ZATCA later only adds a network client; these
-- tables, the XML, the hash chain and the signature stay as they are.
-- Design: docs/DESIGN_ZATCA_PHASE2.md. Feature flag: ZATCA_ENABLED (off by default).
--
--  * zatca_devices:  one EGS unit per branch and environment. Holds the seller's legal/address
--    data, the key pair (private key ENCRYPTED, AES-256-GCM, never plain), the CSR, the CSID
--    certificate once ZATCA issues it, and the running ICV counter + last invoice hash (PIH).
--  * zatca_invoices: one row per issued document (invoice / credit note / debit note): UUID, ICV,
--    PIH, hash, signed XML, QR and the sending state (pending -> reported/cleared/rejected/error).
-- The ICV/PIH chain is advanced INSIDE the sale transaction under a row lock on the device, so it
-- has no gaps and no forks (a failed sale rolls the counter back with it).
-- New table checklist: tenant_id, deleted_at, RLS policy, service_role GRANT.
-- ROLLBACK: DROP TABLE zatca_invoices; DROP TABLE zatca_devices;

CREATE TABLE IF NOT EXISTS zatca_devices (
  id                 UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id          UUID        NOT NULL REFERENCES branches(id),
  env                TEXT        NOT NULL DEFAULT 'sandbox'
                       CHECK (env IN ('sandbox', 'simulation', 'production')),
  egs_serial         TEXT        NOT NULL,
  seller             JSONB       NOT NULL,
  private_key_enc    TEXT,
  csr_pem            TEXT,
  certificate_pem    TEXT,
  csid_secret_enc    TEXT,
  csid_kind          TEXT        CHECK (csid_kind IN ('compliance', 'production')),
  icv_last           BIGINT      NOT NULL DEFAULT 0 CHECK (icv_last >= 0),
  -- first invoice of a device chains to base64(sha256('0')), as the specification defines
  pih_last           TEXT        NOT NULL DEFAULT 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==',
  status             TEXT        NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft', 'csr_ready', 'compliance', 'active', 'disabled')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at         TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_zatca_devices_branch_env
  ON zatca_devices (tenant_id, branch_id, env)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS zatca_invoices (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_id      UUID        NOT NULL REFERENCES zatca_devices(id),
  order_id       UUID        NOT NULL REFERENCES orders(id),
  kind           TEXT        NOT NULL DEFAULT 'invoice'
                   CHECK (kind IN ('invoice', 'credit_note', 'debit_note')),
  uuid           UUID        NOT NULL,
  icv            BIGINT      NOT NULL CHECK (icv >= 1),
  pih            TEXT        NOT NULL,
  invoice_no     TEXT,
  invoice_hash   TEXT        NOT NULL,
  issue_at       TIMESTAMPTZ NOT NULL,
  xml            TEXT        NOT NULL,
  qr             TEXT        NOT NULL,
  signature      TEXT,
  status         TEXT        NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'reported', 'cleared', 'rejected', 'error')),
  attempts       INTEGER     NOT NULL DEFAULT 0,
  last_error     TEXT,
  response       JSONB,
  reported_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ
);

-- ICV is unique per device (the chain), and one issued invoice per order.
CREATE UNIQUE INDEX IF NOT EXISTS uq_zatca_invoices_device_icv ON zatca_invoices (device_id, icv);
CREATE UNIQUE INDEX IF NOT EXISTS uq_zatca_invoices_order_invoice
  ON zatca_invoices (order_id) WHERE kind = 'invoice' AND deleted_at IS NULL;
-- the sender picks pending/error rows in ICV order
CREATE INDEX IF NOT EXISTS idx_zatca_invoices_queue
  ON zatca_invoices (tenant_id, status, device_id, icv)
  WHERE status IN ('pending', 'error') AND deleted_at IS NULL;

ALTER TABLE zatca_devices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_session_isolation ON zatca_devices;
CREATE POLICY tenant_session_isolation ON zatca_devices
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.zatca_devices TO service_role;

ALTER TABLE zatca_invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_session_isolation ON zatca_invoices;
CREATE POLICY tenant_session_isolation ON zatca_invoices
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.zatca_invoices TO service_role;
