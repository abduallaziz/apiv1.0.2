-- =============================================================================
-- 030: Add description column to warehouse_locations
-- The Locations UI exposes Warehouse/Code/Name/Description/Active fields;
-- the table only had `zone` (kept for backward compatibility with any
-- existing data) — adding a dedicated free-text description column.
-- =============================================================================

ALTER TABLE public.warehouse_locations ADD COLUMN IF NOT EXISTS description TEXT;
