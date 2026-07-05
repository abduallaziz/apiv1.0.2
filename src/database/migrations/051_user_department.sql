-- Free-text department/group per employee (e.g. "تقنية المعلومات", "المبيعات"),
-- used for the attendance page's group filter and column. Nullable/additive —
-- no existing tenant/user data is affected.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS department TEXT;
