-- Extends shift patterns to support more than one shift segment per day
-- (split shifts, e.g. 08:00-12:00 + 14:00-00:00) and shifts that cross
-- midnight. A single start_time/end_time pair per pattern can't express
-- either of these, so it's replaced with a `shifts` JSONB array of
-- {start_time, end_time} objects. day_overrides (already JSONB, no schema
-- change needed) now holds { day, shifts: [...] } instead of
-- { day, start_time, end_time } — same idea, just also array-of-shifts.

-- work_schedules previously required end_time > start_time, which blocks
-- storing a shift segment that crosses midnight (e.g. 14:00-00:00, where
-- 00:00 < 14:00 numerically). Drop that constraint — a split-shift day now
-- produces one work_schedules row per segment for the same scheduled_date
-- rather than one row per date, so this table's shape doesn't otherwise
-- change.
DO $$
DECLARE
  con_name TEXT;
BEGIN
  SELECT conname INTO con_name
  FROM pg_constraint
  WHERE conrelid = 'work_schedules'::regclass AND contype = 'c';
  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE work_schedules DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

ALTER TABLE shift_patterns
  DROP COLUMN start_time,
  DROP COLUMN end_time,
  ADD COLUMN shifts JSONB NOT NULL DEFAULT '[]';

ALTER TABLE users
  DROP COLUMN custom_start_time,
  DROP COLUMN custom_end_time,
  ADD COLUMN custom_shifts JSONB;
