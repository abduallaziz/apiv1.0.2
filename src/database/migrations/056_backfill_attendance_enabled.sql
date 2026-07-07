-- 055 added attendance_enabled defaulting to false, which silently broke every
-- attendance link that already existed before the migration (findByAttendanceToken
-- now requires attendance_enabled = true). Backfill: anyone who already has a
-- token was, by definition, already using attendance under the old model.
UPDATE users SET attendance_enabled = true WHERE attendance_token IS NOT NULL AND attendance_enabled = false;
