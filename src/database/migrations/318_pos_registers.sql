-- 318_pos_registers.sql  (POS registers / نقاط البيع — approved design DESIGN_POS_REGISTERS.md 2026-11-15)
-- A register (صندوق) is a named POS the owner creates, one per branch row. The core rule: ONE open shift per
-- register at any instant (taking turns is fine, simultaneous drawers are not) — this is what makes a cash
-- shortage attributable. ADDITIVE and idempotent; existing branches keep working via the backfill below.
-- ROLLBACK: DROP INDEX uq_shifts_one_open_per_register; ALTER TABLE shifts DROP COLUMN register_id;
--           DROP TABLE pos_registers;

CREATE TABLE IF NOT EXISTS pos_registers (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id),
  branch_id   UUID        NOT NULL REFERENCES branches(id),
  name        TEXT        NOT NULL,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);

-- One active register name per branch (case-insensitive).
CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_registers_name
  ON pos_registers (tenant_id, branch_id, lower(name)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pos_registers_branch
  ON pos_registers (tenant_id, branch_id) WHERE deleted_at IS NULL;

-- shifts reference the register they were opened on.
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS register_id UUID REFERENCES pos_registers(id);

-- Backfill: every active branch gets one default register, and its OPEN shifts are linked to it. This makes
-- the new rule behave as "one open shift per branch" for anyone who never defines extra registers.
INSERT INTO pos_registers (tenant_id, branch_id, name)
SELECT b.tenant_id, b.id, 'نقطة البيع'
FROM branches b
WHERE b.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM pos_registers r
    WHERE r.branch_id = b.id AND r.deleted_at IS NULL
  );

UPDATE shifts s
SET register_id = r.id
FROM pos_registers r
WHERE s.register_id IS NULL
  AND s.branch_id = r.branch_id
  AND r.deleted_at IS NULL;

-- THE CORE FIX: at most one open shift per register. Partial unique index (open + not deleted).
CREATE UNIQUE INDEX IF NOT EXISTS uq_shifts_one_open_per_register
  ON shifts (register_id) WHERE status = 'open' AND deleted_at IS NULL AND register_id IS NOT NULL;

-- Permissions: service_role only, never the public API roles (new-table checklist).
ALTER TABLE pos_registers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pos_registers FROM anon, authenticated, PUBLIC;
GRANT ALL PRIVILEGES ON public.pos_registers TO service_role;
