-- item_barcodes was created (098) without a deleted_at column, but every
-- module's repositories extend ScopedRepository, whose scopedQuery() always
-- applies `.is('deleted_at', null)` — a project-wide convention every other
-- tenant-scoped table already satisfies. Any read through ItemBarcodesRepository
-- (findAll/findById/findByBarcode/lookupByBarcode) fails with Postgres 42703
-- "column item_barcodes.deleted_at does not exist" as a result.
--
-- Confirmed directly: GET /api/v1/item-barcodes returned 500 with exactly
-- that error after the 099 privilege fix unblocked writes.
ALTER TABLE item_barcodes ADD COLUMN deleted_at TIMESTAMPTZ;
