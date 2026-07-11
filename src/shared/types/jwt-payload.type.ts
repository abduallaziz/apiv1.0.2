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
}