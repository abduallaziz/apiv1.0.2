export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  // Full role set from user_roles (role names, not UUIDs — guards match
  // against string literals like 'superadmin'/'owner'). `role` above stays
  // the is_primary role for legacy readers; this is additive, Phase 2 of the
  // multi-role migration (see STATUS.md). Optional so tokens signed before
  // this field existed still decode correctly.
  roles?: string[];
  tenant_id: string | null;
  session_id: string;
  business_type: string | null;
  activity: string | null;
  // Branch System Step 4 (Owner-approved) — the acting user's own branch
  // restriction, mirroring users.branch_id: null = Central (unrestricted),
  // a branch id = restricted to that single branch. Optional so tokens
  // signed before this field existed still decode correctly (treated the
  // same as null — Central — by any consumer, never as "restricted to
  // nothing"). Superadmin tokens never carry this; superadmin branch scope
  // continues to come from the x-branch-id header exactly as today.
  branch_id?: string | null;
}
