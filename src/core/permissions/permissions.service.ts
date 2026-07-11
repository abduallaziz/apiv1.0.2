import { Injectable, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';
import { RedisCacheService } from '../cache/redis-cache.service';

// S5 Stage B — tenant-aware permission resolution.
// Base grants still come from the global, permanent role_permissions table
// (unchanged). tenant_role_permissions applies a PER-PERMISSION-KEY merge on
// top of that base, not a wholesale replacement:
//   is_granted = true  -> add that key to the granted set
//   is_granted = false -> remove that key from the granted set
// A tenant with zero override rows resolves to exactly the same set as
// before this change — that's what makes this additive-safe.
//
// Cache key now encodes the tenant so two tenants never share a cache entry
// for the same role. When tenantId is null/undefined (superadmin context,
// or any caller that genuinely has none), behavior and the cache key format
// are byte-identical to pre-Stage-B code — tenant_role_permissions is never
// queried in that case.
const PERMISSIONS_TTL = 600;
const cacheKey = (role: string, tenantId?: string | null) =>
  tenantId ? `permissions:tenant:${tenantId}:role:${role}` : `permissions:role:${role}`;

// Phase 2 of the multi-role migration (see STATUS.md) — deliberately a
// separate key namespace from cacheKey() above (permissions:user:* vs
// permissions:role:*), so caching a user's merged multi-role result can
// never collide with or invalidate a single-role cache entry used by the
// still-untouched hasPermission()/getGrantedSet() path.
const userCacheKey = (userId: string, tenantId?: string | null) =>
  tenantId ? `permissions:user:${userId}:tenant:${tenantId}` : `permissions:user:${userId}`;

// INTERMEDIATE API — hasPermission(role, permissionKey, tenantId) is Stage B
// of the tenant-aware authorization migration. It intentionally does NOT yet
// support multiple roles per user, user-level exceptions, data scope, or
// policies — those require a richer context than (role, key, tenantId) can
// express. Target future API: hasAccess(userId, permissionKey, context),
// which will resolve the user's full role set, apply this same per-key merge
// per role, union across roles, then apply scope/policy/exception layers per
// the approved decision order. hasPermission will become an internal helper
// called by hasAccess once that stage ships, not a public entry point.
@Injectable()
export class PermissionsService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
    private readonly cache: RedisCacheService,
  ) {}

  async hasPermission(
    role: string,
    permissionKey: string,
    tenantId?: string | null,
  ): Promise<boolean> {
    // 'owner' is forced true for every permission, unconditionally — not a
    // cosmetic UI lock, this is the actual enforcement path PermissionGuard
    // calls on every request. Short-circuits before any cache/DB round trip
    // so it can never depend on role_permissions seed data being complete,
    // and can never be affected by a stray tenant_role_permissions row.
    if (role === 'owner') return true;

    const granted = await this.getGrantedSet(role, tenantId);
    return granted.has(permissionKey);
  }

  async getRolePermissions(role: string, tenantId?: string | null): Promise<string[]> {
    const granted = await this.getGrantedSet(role, tenantId);
    return Array.from(granted);
  }

  async invalidateRole(role: string, tenantId?: string | null): Promise<void> {
    await this.cache.del(cacheKey(role, tenantId));
  }

  // Phase 2 of the multi-role migration — not called from anywhere yet (no
  // write path assigns/revokes user_roles rows until Phase 3), but the cache
  // it invalidates already exists via hasPermissionForUser below, so this is
  // added now rather than left as a gap to remember later.
  async invalidateUserPermissions(userId: string, tenantId?: string | null): Promise<void> {
    await this.cache.del(userCacheKey(userId, tenantId));
  }

  // Phase 2 of the multi-role migration — union of every role a user holds
  // via user_roles, replacing the single-role assumption hasPermission()
  // above still makes. hasPermission() itself is untouched; this is a fully
  // separate entry point existing guards do not call yet.
  async hasPermissionForUser(
    userId: string,
    permissionKey: string,
    tenantId?: string | null,
  ): Promise<boolean> {
    const roles = await this.fetchUserRoleNames(userId);

    // Same force-true rule hasPermission() applies to 'owner' — if any role
    // held by this user is 'owner', every permission resolves true,
    // regardless of what the other held roles grant or deny.
    if (roles.includes('owner')) return true;

    const granted = await this.getGrantedSetForUser(userId, roles, tenantId);
    return granted.has(permissionKey);
  }

  private async getGrantedSetForUser(
    userId: string,
    roles: string[],
    tenantId?: string | null,
  ): Promise<Set<string>> {
    const key = userCacheKey(userId, tenantId);

    const cached = await this.cache.get<string[]>(key);
    if (cached) return new Set(cached);

    const merged = new Set<string>();
    for (const role of roles) {
      const keys = await this.resolveGrantedKeys(role, tenantId);
      for (const k of keys) merged.add(k);
    }

    const result = Array.from(merged);
    await this.cache.set(key, result, PERMISSIONS_TTL);
    return merged;
  }

  private async fetchUserRoleNames(userId: string): Promise<string[]> {
    const { data, error } = await this.supabase
      .from('user_roles')
      .select('role:roles!user_roles_role_id_fkey(name)')
      .eq('user_id', userId);

    if (error || !data) return [];
    return data
      .map((row: any) => row.role?.name as string | undefined)
      .filter((name): name is string => !!name);
  }

  // S5 Stage C — shared resolution detail for the access-control admin API.
  // Reuses the exact same merge logic as hasPermission/getGrantedSet (not a
  // parallel implementation), so the admin "what does this role have and
  // why" view can never disagree with what PermissionGuard actually enforces.
  // Deliberately bypasses the cache (admin screens need up-to-the-second
  // accuracy right after a write, not a up-to-10-minutes-stale cached view).
  async getResolutionDetail(
    role: string,
    tenantId?: string | null,
  ): Promise<{ grantedKeys: Set<string>; overrides: Map<string, boolean> }> {
    // Same force-true rule as hasPermission — empty overrides map on purpose:
    // this bypasses tenant_role_permissions entirely for 'owner', it doesn't
    // just happen to agree with it. Even a stray override row can never
    // change what's displayed or enforced for this role.
    if (role === 'owner') {
      const allKeys = await this.fetchAllTenantPermissionKeys();
      return { grantedKeys: new Set(allKeys), overrides: new Map() };
    }

    const globalKeys = await this.fetchGlobalGrants(role);
    const overrides = new Map<string, boolean>();

    if (!tenantId) {
      return { grantedKeys: new Set(globalKeys), overrides };
    }

    const roleId = await this.lookupRoleId(role, tenantId);
    if (!roleId) {
      return { grantedKeys: new Set(globalKeys), overrides };
    }

    const overrideRows = await this.fetchTenantOverrides(tenantId, roleId);
    const merged = new Set(globalKeys);
    for (const row of overrideRows) {
      overrides.set(row.permission_key, row.is_granted);
      if (row.is_granted) merged.add(row.permission_key);
      else merged.delete(row.permission_key);
    }

    return { grantedKeys: merged, overrides };
  }

  private async getGrantedSet(role: string, tenantId?: string | null): Promise<Set<string>> {
    const key = cacheKey(role, tenantId);

    const cached = await this.cache.get<string[]>(key);
    if (cached) return new Set(cached);

    const permissions = await this.resolveGrantedKeys(role, tenantId);
    await this.cache.set(key, permissions, PERMISSIONS_TTL);
    return new Set(permissions);
  }

  private async resolveGrantedKeys(role: string, tenantId?: string | null): Promise<string[]> {
    // getRolePermissions() (used by getEditableRoleOrThrow's caller chain and
    // anywhere else that lists rather than checks a single key) goes through
    // here — same force-true rule, kept consistent with hasPermission and
    // getResolutionDetail rather than re-special-cased at every call site.
    if (role === 'owner') return this.fetchAllTenantPermissionKeys();

    const globalKeys = await this.fetchGlobalGrants(role);

    if (!tenantId) return globalKeys;

    const roleId = await this.lookupRoleId(role, tenantId);
    if (!roleId) return globalKeys;

    const overrides = await this.fetchTenantOverrides(tenantId, roleId);
    if (overrides.length === 0) return globalKeys;

    const merged = new Set(globalKeys);
    for (const override of overrides) {
      if (override.is_granted) merged.add(override.permission_key);
      else merged.delete(override.permission_key);
    }
    return Array.from(merged);
  }

  private async fetchGlobalGrants(role: string): Promise<string[]> {
    const { data, error } = await this.supabase
      .from('role_permissions')
      .select('permission_key')
      .eq('role', role)
      .eq('is_granted', true);

    if (error || !data) return [];
    return data.map((row) => row.permission_key);
  }

  // Every non-platform permission key that exists — the actual definition of
  // "owner always has everything." Excludes resource='superadmin' the same
  // way AccessControlRepository.listPermissionsCatalog(false) does: owner
  // has full access within their own tenant, not platform-level access.
  private async fetchAllTenantPermissionKeys(): Promise<string[]> {
    const { data, error } = await this.supabase
      .from('permissions')
      .select('name')
      .neq('resource', 'superadmin');

    if (error || !data) return [];
    return data.map((row) => row.name);
  }

  private async fetchTenantOverrides(
    tenantId: string,
    roleId: string,
  ): Promise<{ permission_key: string; is_granted: boolean }[]> {
    const { data, error } = await this.supabase
      .from('tenant_role_permissions')
      .select('permission_key, is_granted')
      .eq('tenant_id', tenantId)
      .eq('role_id', roleId);

    if (error || !data) return [];
    return data;
  }

  // System roles never change (7 fixed rows, seeded once in migration 059),
  // so this is cached indefinitely per-process rather than re-queried on
  // every permission check. Returns null if no matching system role exists
  // (should not happen given the seed) — callers fall back to the global
  // grant set exactly as if no tenant existed, never throw.
  private systemRoleIdCache = new Map<string, string>();

  private async lookupSystemRoleId(role: string): Promise<string | null> {
    const cached = this.systemRoleIdCache.get(role);
    if (cached) return cached;

    const { data, error } = await this.supabase
      .from('roles')
      .select('id')
      .eq('name', role)
      .is('tenant_id', null)
      .maybeSingle();

    if (error || !data) return null;
    this.systemRoleIdCache.set(role, data.id);
    return data.id;
  }

  // Real bug found via live testing (user report: toggled permissions on a
  // custom role reverted to ungranted after closing and reopening the
  // sheet): resolveGrantedKeys/getResolutionDetail only ever called
  // lookupSystemRoleId, which filters `tenant_id IS NULL` — a custom role's
  // row always has tenant_id set, so the lookup silently returned null and
  // both callers fell back to "no matching role -> just return global
  // grants," meaning tenant_role_permissions overrides were never read back
  // for any custom role, ever. The write path (upsertOverride) was always
  // correct; only this read path ignored what it wrote.
  //
  // Deliberately NOT folded into systemRoleIdCache: that cache is keyed by
  // name only, which is safe for the 7 globally-unique system roles but
  // would be wrong for custom roles — two different tenants can each name a
  // role "Supervisor" (unique only per-tenant, via idx_roles_tenant_name_unique),
  // so caching by name alone here would leak tenant A's roleId into tenant
  // B's lookup for the same name.
  private async lookupRoleId(role: string, tenantId?: string | null): Promise<string | null> {
    const systemId = await this.lookupSystemRoleId(role);
    if (systemId) return systemId;
    if (!tenantId) return null;

    const { data, error } = await this.supabase
      .from('roles')
      .select('id')
      .eq('name', role)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (error || !data) return null;
    return data.id;
  }
}
