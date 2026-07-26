-- Purchasing #9.5.6.3: fn_create_agreement_release -- atomic insert of
-- agreement_releases header + agreement_release_items, only. All
-- business logic (eligibility, remaining-quantity/overage check,
-- pricing snapshot computation, effective_amendment_id resolution)
-- happens in ReleasesService BEFORE calling this function -- the RPC
-- receives already-computed values and does persistence only, same
-- responsibility split as fn_approve_agreement_amendment (137).
--
-- Existing create() methods elsewhere in Purchasing (RFQ, Awards,
-- Agreements, Amendments) insert header then items as two separate
-- REST calls with no rollback on item-insert failure -- a real,
-- pre-existing orphan-header gap, documented as technical debt and
-- explicitly NOT fixed here (out of scope), fixed only for this new
-- Release path going forward.
--
-- Integrity guards (defense in depth, not just "trust the caller"):
-- agreement must belong to the tenant AND be 'approved'; every item's
-- agreement_item_id must actually belong to p_agreement_id AND
-- p_tenant_id; effective_amendment_id (if provided) must belong to the
-- same tenant AND agreement (via the composite unique index added in
-- 133) -- same class of cross-agreement guard already proven in 137.
--
-- p_items JSONB contract (array of objects), all fields pre-computed
-- by the Service, none derived here:
--   agreement_item_id          UUID
--   released_quantity          NUMERIC
--   snapshot_unit_price        NUMERIC
--   snapshot_discount_percent  NUMERIC (nullable, defaults to 0)
--   snapshot_currency          TEXT
--   snapshot_tax_rate          NUMERIC (nullable)
--   released_amount            NUMERIC
--   source_pricing_tier_id     UUID (nullable)
--   notes                      TEXT (nullable)

CREATE FUNCTION fn_create_agreement_release(
  p_tenant_id              UUID,
  p_agreement_id           UUID,
  p_release_number         TEXT,
  p_notes                  TEXT,
  p_effective_amendment_id UUID,
  p_created_by             UUID,
  p_items                  JSONB
) RETURNS agreement_releases
LANGUAGE plpgsql
AS $$
DECLARE
  v_release           agreement_releases%ROWTYPE;
  v_agreement_status   TEXT;
  v_item               JSONB;
  v_agreement_item_id  UUID;
  v_item_belongs       BOOLEAN;
BEGIN
  SELECT status INTO v_agreement_status
  FROM agreements
  WHERE id = p_agreement_id AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agreement % not found for tenant %', p_agreement_id, p_tenant_id;
  END IF;

  IF v_agreement_status != 'approved' THEN
    RAISE EXCEPTION 'Cannot create a release for agreement with status: %', v_agreement_status;
  END IF;

  IF p_effective_amendment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM agreement_amendments
    WHERE id = p_effective_amendment_id
      AND tenant_id = p_tenant_id
      AND agreement_id = p_agreement_id
  ) THEN
    RAISE EXCEPTION
      'effective_amendment_id % does not belong to agreement % (or tenant mismatch)',
      p_effective_amendment_id, p_agreement_id;
  END IF;

  INSERT INTO agreement_releases (
    tenant_id, agreement_id, release_number, notes,
    effective_amendment_id, created_by, status
  ) VALUES (
    p_tenant_id, p_agreement_id, p_release_number, p_notes,
    p_effective_amendment_id, p_created_by, 'draft'
  ) RETURNING * INTO v_release;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_agreement_item_id := (v_item->>'agreement_item_id')::UUID;

    SELECT EXISTS (
      SELECT 1 FROM agreement_items
      WHERE id = v_agreement_item_id
        AND tenant_id = p_tenant_id
        AND agreement_id = p_agreement_id
    ) INTO v_item_belongs;

    IF NOT v_item_belongs THEN
      RAISE EXCEPTION
        'agreement_item % does not belong to agreement % (or tenant mismatch)',
        v_agreement_item_id, p_agreement_id;
    END IF;

    INSERT INTO agreement_release_items (
      tenant_id, release_id, agreement_item_id, released_quantity,
      snapshot_unit_price, snapshot_discount_percent, snapshot_currency,
      snapshot_tax_rate, released_amount, source_pricing_tier_id, notes
    ) VALUES (
      p_tenant_id, v_release.id, v_agreement_item_id,
      (v_item->>'released_quantity')::NUMERIC,
      (v_item->>'snapshot_unit_price')::NUMERIC,
      COALESCE((v_item->>'snapshot_discount_percent')::NUMERIC, 0),
      v_item->>'snapshot_currency',
      (v_item->>'snapshot_tax_rate')::NUMERIC,
      (v_item->>'released_amount')::NUMERIC,
      NULLIF(v_item->>'source_pricing_tier_id', '')::UUID,
      v_item->>'notes'
    );
  END LOOP;

  RETURN v_release;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_create_agreement_release(UUID, UUID, TEXT, TEXT, UUID, UUID, JSONB) TO service_role;
