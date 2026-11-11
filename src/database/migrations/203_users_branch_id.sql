-- Branch System Step 2 (Owner-approved): users gain an optional branch
-- assignment. NULL = Central user (unrestricted, current behavior for every
-- existing row after this migration — no backfill needed since the column
-- defaults to NULL). A non-NULL value restricts the user to that single
-- branch. No join table, no is_central flag — branch_id IS NULL already
-- carries that meaning.
ALTER TABLE users
  ADD COLUMN branch_id UUID REFERENCES branches(id);

CREATE INDEX idx_users_branch_id ON users (branch_id);
