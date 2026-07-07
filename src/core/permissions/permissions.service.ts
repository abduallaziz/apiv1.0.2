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

  private async getGrantedSet(role: string, tenantId?: string | null): Promise<Set<string>> {
    const key = cacheKey(role, tenantId);

    const cached = await this.cache.get<string[]>(key);
    if (cached) return new Set(cached);

    const permissions = await this.resolveGrantedKeys(role, tenantId);
    await this.cache.set(key, permissions, PERMISSIONS_TTL);
    return new Set(permissions);
  }

  private async resolveGrantedKeys(role: string, tenantId?: string | null): Promise<string[]> {
    const globalKeys = await this.fetchGlobalGrants(role);

    if (!tenantId) return globalKeys;

    const roleId = await this.lookupSystemRoleId(role);
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
}
