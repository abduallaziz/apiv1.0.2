-- Phase 10I (cont.) — Personal attendance link, so employees can punch in/out from their
-- own phone without a full dashboard login. There is no memorized secret: the token in the
-- link identifies WHO, and the GPS geofence check gates WHETHER the action is allowed at
-- all — no confirmation code is even generated unless the location check passes.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS attendance_token TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS attendance_device_fingerprint TEXT;

CREATE INDEX IF NOT EXISTS idx_users_attendance_token ON users(attendance_token) WHERE attendance_token IS NOT NULL;

-- Server-minted one-time code, issued only after a successful geofence check, stored as an
-- audit stamp on the resulting attendance record (proof this specific check-in/out passed
-- location validation at the time it happened).
ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS check_in_code TEXT,
  ADD COLUMN IF NOT EXISTS check_out_code TEXT;
