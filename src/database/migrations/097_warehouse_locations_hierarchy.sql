-- =============================================================================
-- 097 — warehouse_locations: hierarchy foundation (Zone -> Aisle -> Rack ->
-- Shelf -> Bin)
-- =============================================================================
-- Additive only. Existing `zone` text column is untouched — nothing reads or
-- writes it differently. New columns are nullable so all 9 existing rows
-- remain valid with parent_location_id=NULL, location_type=NULL. Enforcing
-- "no illogical nesting" (e.g. a Bin containing a Bin) as a hard DB
-- constraint would require a recursive CHECK, which Postgres CHECK
-- constraints cannot express directly — instead we encode the legal
-- parent->child sequence as a lookup table + trigger, which also gives a
-- clear error message instead of an opaque constraint violation.
-- =============================================================================

ALTER TABLE warehouse_locations
  ADD COLUMN parent_location_id UUID REFERENCES warehouse_locations(id) ON DELETE SET NULL,
  ADD COLUMN location_type TEXT CHECK (location_type IN ('zone', 'aisle', 'rack', 'shelf', 'bin'));

CREATE INDEX idx_locations_parent ON warehouse_locations(parent_location_id) WHERE parent_location_id IS NOT NULL;

-- Enforces the fixed hierarchy order: zone -> aisle -> rack -> shelf -> bin.
-- A location with a parent must be exactly one level below its parent's
-- type; a location with location_type set but no parent must be a 'zone'
-- (the top of the hierarchy). Locations with location_type IS NULL (every
-- existing row today) are exempt — this only governs newly-typed rows.
CREATE OR REPLACE FUNCTION fn_validate_location_hierarchy()
RETURNS TRIGGER AS $$
DECLARE
  v_parent_type TEXT;
  v_allowed_child TEXT;
BEGIN
  IF NEW.location_type IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.parent_location_id IS NULL THEN
    IF NEW.location_type <> 'zone' THEN
      RAISE EXCEPTION 'INVALID_LOCATION_HIERARCHY: a top-level location (no parent) must be a zone, got %', NEW.location_type;
    END IF;
    RETURN NEW;
  END IF;

  SELECT location_type INTO v_parent_type FROM warehouse_locations WHERE id = NEW.parent_location_id;

  v_allowed_child := CASE v_parent_type
    WHEN 'zone'  THEN 'aisle'
    WHEN 'aisle' THEN 'rack'
    WHEN 'rack'  THEN 'shelf'
    WHEN 'shelf' THEN 'bin'
    ELSE NULL
  END;

  IF v_allowed_child IS NULL OR NEW.location_type <> v_allowed_child THEN
    RAISE EXCEPTION 'INVALID_LOCATION_HIERARCHY: a % cannot be placed under a % (expected child type: %)',
      NEW.location_type, COALESCE(v_parent_type, 'untyped location'), COALESCE(v_allowed_child, 'none');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validate_location_hierarchy
  BEFORE INSERT OR UPDATE ON warehouse_locations
  FOR EACH ROW
  EXECUTE FUNCTION fn_validate_location_hierarchy();
