-- job_title: free-text specific role label (e.g. "مطور برمجيات") shown under
-- the employee's name, distinct from the system `role` enum (owner/manager/
-- cashier/worker) used for permissions.
-- avatar_url: nullable for now — no photo upload UI exists yet, but the
-- column is added so the attendance page can show a real photo once upload
-- is added later, falling back to an initials avatar until then.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS job_title TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;
