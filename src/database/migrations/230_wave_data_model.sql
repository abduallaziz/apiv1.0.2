-- 230. Inventory #7 / Migration Item 7-4 (Owner-approved) — Wave Data
-- Model. Schema only, per the approved matrix — eligibility evaluation
-- (7-5) and claim/release logic (7-6) are explicitly out of scope for
-- this item and are not implemented here.
--
-- Wave is a first-class entity, not pick_lists.strategy='wave' and not
-- "Batch + timestamp" (both explicitly forbidden by the approved
-- architecture). criteria is JSONB specifically so the eligibility
-- evaluator (7-5) can support the full approved criteria list —
-- warehouse/priority/zone/route/carrier/cutoff/release-window/order-type/
-- customer-service-level/inventory-readiness/replenishment-readiness/
-- capacity/labor/dock — by extending which keys it understands, never by
-- a schema migration. Capacity/labor/dock signals are explicitly
-- out-of-domain for Inventory (Owner-approved §5.4) and are consumed here
-- only as opaque JSONB keys some future external domain writes into
-- criteria before evaluation — no fake Workforce/Scheduling tables are
-- created.

CREATE TABLE waves (
  id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  warehouse_id        UUID        NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  status              TEXT        NOT NULL DEFAULT 'planning'
                        CHECK (status IN ('planning', 'evaluating', 'reviewing', 'released', 'picking', 'completed', 'cancelled')),
  criteria            JSONB       NOT NULL DEFAULT '{}'::jsonb,
  cancellation_reason TEXT,
  created_by          UUID        REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  evaluated_at        TIMESTAMPTZ,
  released_at         TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  cancelled_at        TIMESTAMPTZ,

  -- Terminal-state timestamp integrity: a wave can be in at most one
  -- terminal state, and its timestamp must be set exactly when that
  -- state is reached — prevents a completed wave with no completed_at,
  -- or a wave stamped as both completed and cancelled.
  CONSTRAINT chk_wave_not_both_completed_and_cancelled
    CHECK (NOT (completed_at IS NOT NULL AND cancelled_at IS NOT NULL)),
  CONSTRAINT chk_wave_completed_at_matches_status
    CHECK ((status = 'completed') = (completed_at IS NOT NULL)),
  CONSTRAINT chk_wave_cancelled_at_matches_status
    CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  -- released_at must be set once the wave has reached 'released' or any
  -- later stage (picking/completed) — but cancellation can happen from
  -- pre-picking stages regardless of whether release ever occurred, so
  -- this is a one-directional implication, not an equality.
  CONSTRAINT chk_wave_released_at_set_when_past_reviewing
    CHECK (status NOT IN ('released', 'picking', 'completed') OR released_at IS NOT NULL),
  CONSTRAINT chk_wave_cancellation_reason_requires_cancelled
    CHECK (cancellation_reason IS NULL OR status = 'cancelled')
);
CREATE INDEX idx_waves_tenant_status ON waves(tenant_id, status);
CREATE INDEX idx_waves_tenant_warehouse ON waves(tenant_id, warehouse_id);
ALTER TABLE waves ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON waves
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.waves TO service_role;

-- One row per shipment a wave has evaluated — whether it ended up
-- included or excluded, and why (JSONB so 7-5's evaluator can record
-- exactly which criteria matched/failed, per the approved auditability
-- requirement "why it was excluded when relevant"). Exactly one of
-- included_reason/excluded_reason is set, never both, never neither.
CREATE TABLE wave_shipments (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  wave_id          UUID        NOT NULL REFERENCES waves(id) ON DELETE CASCADE,
  shipment_id      UUID        NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  included_reason  JSONB,
  excluded_reason  JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_wave_shipment_exactly_one_reason
    CHECK ((included_reason IS NOT NULL) <> (excluded_reason IS NOT NULL)),
  -- A shipment is evaluated by a given wave at most once — 7-5's
  -- evaluator must upsert/replace, never append a second row for the
  -- same (wave, shipment) pair.
  CONSTRAINT uq_wave_shipment UNIQUE (wave_id, shipment_id)
);
CREATE INDEX idx_wave_shipments_wave ON wave_shipments(tenant_id, wave_id);
CREATE INDEX idx_wave_shipments_shipment ON wave_shipments(tenant_id, shipment_id);
ALTER TABLE wave_shipments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON wave_shipments
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.wave_shipments TO service_role;

-- Links a pick list back to the wave that produced it (7-6, not yet
-- implemented). Nullable: single/batch/zone pick lists never have one.
ALTER TABLE pick_lists ADD COLUMN wave_id UUID REFERENCES waves(id) ON DELETE SET NULL;
CREATE INDEX idx_pick_lists_wave ON pick_lists(tenant_id, wave_id) WHERE wave_id IS NOT NULL;

-- Integrity protection required by the approved architecture: "Wave...
-- must not be reduced to pick_lists.strategy='wave'" — a wave-strategy
-- pick list MUST originate from a real wave (wave_id set); a
-- single/batch/zone pick list must NEVER carry a wave_id. This closes
-- off the exact bypass the approved model explicitly forbids, even
-- before 7-6's release logic exists to populate it — until 7-6 ships,
-- no strategy='wave' pick list can be created at all, which is the
-- correct interim state (there is no other legitimate way to produce one).
ALTER TABLE pick_lists ADD CONSTRAINT chk_pick_list_wave_strategy_requires_wave
  CHECK ((strategy = 'wave') = (wave_id IS NOT NULL));
