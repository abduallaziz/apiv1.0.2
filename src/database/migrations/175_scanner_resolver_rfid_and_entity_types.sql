-- Migration 13.21 Phase 5 — Resolver Engine support.
--
-- Two additive changes, neither touching protected Sefay Core:
--
-- 1) item_rfid_tags: genuinely new master data — Sefay has never had RFID
--    support (confirmed zero pre-existing RFID infrastructure in the
--    Phase 1 audit), so this is not a duplicate of anything. Mirrors
--    item_barcodes' shape (one-to-many with items/item_variants, unique
--    tag value per tenant) since it plays the identical role — a physical
--    identifier resolving to exactly one item/variant.
--
-- 2) scanner_events.resolved_entity_type CHECK widened from migration
--    172's placeholder ('item'/'location'/'batch'/'serial'/'unresolved')
--    to include 'variant' and 'rfid' — the Resolver Engine's actual
--    supported entity set, worked out in this phase's design.

CREATE TABLE item_rfid_tags (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_id     UUID        NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  variant_id  UUID        REFERENCES item_variants(id) ON DELETE CASCADE,
  tag_value   TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX uq_item_rfid_tags_tenant_tag ON item_rfid_tags(tenant_id, tag_value);
CREATE INDEX idx_item_rfid_tags_item ON item_rfid_tags(item_id);

ALTER TABLE item_rfid_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON item_rfid_tags
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.item_rfid_tags TO service_role;

DO $$
DECLARE
  con_name text;
BEGIN
  SELECT conname INTO con_name
  FROM pg_constraint
  WHERE conrelid = 'scanner_events'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%resolved_entity_type%';
  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE scanner_events DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

ALTER TABLE scanner_events
  ADD CONSTRAINT scanner_events_resolved_entity_type_check
  CHECK (resolved_entity_type IN ('item', 'variant', 'location', 'batch', 'serial', 'rfid', 'unresolved'));

-- Rollback (documented, not auto-executed):
-- ALTER TABLE scanner_events DROP CONSTRAINT scanner_events_resolved_entity_type_check;
-- ALTER TABLE scanner_events ADD CONSTRAINT scanner_events_resolved_entity_type_check CHECK (resolved_entity_type IN ('item','location','batch','serial','unresolved'));
-- DROP TABLE IF EXISTS item_rfid_tags;
