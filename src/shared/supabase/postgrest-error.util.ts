// F2 — shared Supabase/PostgREST error predicates. Pure boolean checks
// only: no exception construction, no messages, no business logic. Every
// caller decides for itself what to throw; this file only answers "is
// this a unique-violation / foreign-key-violation error".
//
// PostgrestError shape confirmed empirically (accounting.service.ts fix,
// 2026-08-15): {code, details, hint, message} only — no `.constraint`
// field, unlike the raw `pg` driver.

export interface PostgrestError {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}

export function isPostgrestError(error: unknown): error is PostgrestError {
  return typeof error === 'object' && error !== null && 'code' in error;
}

// SQLSTATE 23505 — unique_violation.
export function isUniqueViolation(error: unknown): boolean {
  return isPostgrestError(error) && error.code === '23505';
}

// SQLSTATE 23503 — foreign_key_violation.
export function isForeignKeyViolation(error: unknown): boolean {
  return isPostgrestError(error) && error.code === '23503';
}
