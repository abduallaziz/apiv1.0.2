-- Order-notes feature. Previously `orders.notes` (migration 001) was a free-text
-- column with zero POS UI writing to it — a cashier had no way to attach a note
-- to an order at all. This adds a real, tenant-managed list of reusable preset
-- notes (e.g. "Ring the bell before delivery") a manager configures once, so
-- cashiers can pick from a list instead of retyping the same notes every order.
-- The `orders.notes` contract itself is unchanged — presets are just a source of
-- text that gets joined into that same single free-text column at checkout.

CREATE TABLE note_presets (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  text        TEXT        NOT NULL,
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ
);

CREATE INDEX idx_note_presets_tenant_active_sort
  ON note_presets (tenant_id, is_active, sort_order) WHERE deleted_at IS NULL;

ALTER TABLE note_presets ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON note_presets
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

INSERT INTO permissions (name, resource, action, description, group_id)
VALUES (
  'note_presets.manage', 'note_presets', 'manage', 'Create and manage preset order notes',
  (SELECT id FROM permission_groups WHERE code = 'sales')
)
ON CONFLICT (name) DO UPDATE SET group_id = EXCLUDED.group_id;

GRANT ALL PRIVILEGES ON public.note_presets TO service_role;
