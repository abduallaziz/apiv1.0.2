import { Injectable, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';
import { HARDCODED_PLATFORM_ONLY_KEYS } from './platform-only-permissions.const';

export interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  tenant_id: string | null;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

export interface PermissionRow {
  id: string;
  name: string;
  resource: string;
  action: string;
  description: string | null;
  group_id: string | null;
  group_code: string | null;
}

@Injectable()
export class AccessControlRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async listPermissionGroups() {
    const { data, error } = await this.supabase
      .from('permission_groups')
      .select('id, code, name_ar, name_en, sort_order')
      .order('sort_order', { ascending: true });

    if (error) throw error;
    return data ?? [];
  }

  // Excludes resource='superadmin' entries unless the caller is superadmin —
  // platform-only permissions should never even be listed as a tenant-facing
  // option, not just rejected on write (defense in depth).
  async listPermissionsCatalog(includeSuperadmin: boolean): Promise<PermissionRow[]> {
    let query = this.supabase
      .from('permissions')
      .select('id, name, resource, action, description, group_id, permission_groups(code)')
      .order('name', { ascending: true });

    if (!includeSuperadmin) {
      query = query.neq('resource', 'superadmin');
    }

    const { data, error } = await query;
    if (error) throw error;

    const rows = includeSuperadmin
      ? (data ?? [])
      : (data ?? []).filter((row: any) => !HARDCODED_PLATFORM_ONLY_KEYS.has(row.name));

    return rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      resource: row.resource,
      action: row.action,
      description: row.description,
      group_id: row.group_id,
      group_code: row.permission_groups?.code ?? null,
    }));
  }

  // System roles (tenant_id IS NULL) + this tenant's own custom roles.
  // 'superadmin' excluded explicitly — it's a platform-level role, never
  // meant to be visible or assignable from a tenant-facing screen at all.
  async listRolesForTenant(tenantId: string): Promise<RoleRow[]> {
    const { data, error } = await this.supabase
      .from('roles')
      .select('id, name, description, tenant_id, is_system, created_at, updated_at')
      .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
      .neq('name', 'superadmin')
      .order('name', { ascending: true });

    if (error) throw error;
    return data ?? [];
  }

  async getRoleById(roleId: string): Promise<RoleRow | null> {
    const { data, error } = await this.supabase
      .from('roles')
      .select('id, name, description, tenant_id, is_system, created_at, updated_at')
      .eq('id', roleId)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  async createRole(tenantId: string, name: string, description: string | null): Promise<RoleRow> {
    const { data, error } = await this.supabase
      .from('roles')
      .insert({ tenant_id: tenantId, name, description, is_system: false })
      .select('id, name, description, tenant_id, is_system, created_at, updated_at')
      .single();

    if (error) {
      // idx_roles_tenant_name_unique — same name already exists for this tenant.
      if (error.code === '23505') {
        throw new Error('DUPLICATE_ROLE_NAME');
      }
      throw error;
    }
    return data;
  }

  // tenant_id filter here is defense-in-depth alongside the service-layer
  // ownership check — a delete must never succeed against a system role
  // (tenant_id IS NULL) or another tenant's role even if the service check
  // were ever bypassed or modified incorrectly later.
  async deleteRole(tenantId: string, roleId: string): Promise<void> {
    const { error } = await this.supabase
      .from('roles')
      .delete()
      .eq('id', roleId)
      .eq('tenant_id', tenantId);

    if (error) throw error;
  }

  async getPermissionByKey(permissionKey: string): Promise<{ name: string; resource: string } | null> {
    const { data, error } = await this.supabase
      .from('permissions')
      .select('name, resource')
      .eq('name', permissionKey)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  // Phase 3 — backs the "Manage Users" panel. Deliberately reads user_roles
  // (the source of truth for full role membership, including secondary
  // roles), not users.role_id like countUsersForRole() above (which only
  // reflects each user's PRIMARY role) — so a user holding this role as a
  // secondary assignment still shows up here.
  //
  // !inner + eq('user.tenant_id', ...) is mandatory, not optional: a system
  // role's id is shared across every tenant, so without this filter every
  // tenant's users holding that system role would leak into the result.
  async getUsersByRole(roleId: string, tenantId: string): Promise<
    { id: string; name: string; email: string; is_active: boolean; is_primary: boolean }[]
  > {
    const { data, error } = await this.supabase
      .from('user_roles')
      .select('is_primary, user:users!user_roles_user_id_fkey!inner(id, name, email, is_active, tenant_id, deleted_at)')
      .eq('role_id', roleId)
      .eq('user.tenant_id', tenantId)
      .is('user.deleted_at', null);

    if (error) throw error;
    return (data ?? []).map((row: any) => ({
      id: row.user.id,
      name: row.user.name,
      email: row.user.email,
      is_active: row.user.is_active,
      is_primary: row.is_primary,
    }));
  }

  // Deliberately reads user_roles — the exact same table getUsersByRole()
  // above reads — instead of users.role_id. Two different sources of truth
  // for "how many users hold this role" is what caused a real reported bug
  // (RoleCard showing 3 users, RoleUsersSheet showing 0): users.role_id can
  // go stale for any user whose role changed through a legacy write path
  // that only touched users.role, not role_id/user_roles (see migration 088).
  // Counting from user_roles here guarantees the card's number and the
  // sheet's list can never disagree again, by construction.
  async countUsersForRole(roleId: string, tenantId: string): Promise<number> {
    const { count, error } = await this.supabase
      .from('user_roles')
      .select('id, user:users!user_roles_user_id_fkey!inner(id)', { count: 'exact', head: true })
      .eq('role_id', roleId)
      .eq('user.tenant_id', tenantId)
      .is('user.deleted_at', null);

    if (error) throw error;
    return count ?? 0;
  }

  async countCustomizedPermissions(tenantId: string, roleId: string): Promise<number> {
    const { count, error } = await this.supabase
      .from('tenant_role_permissions')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('role_id', roleId);

    if (error) throw error;
    return count ?? 0;
  }

  async getOverride(
    tenantId: string,
    roleId: string,
    permissionKey: string,
  ): Promise<{ is_granted: boolean } | null> {
    const { data, error } = await this.supabase
      .from('tenant_role_permissions')
      .select('is_granted')
      .eq('tenant_id', tenantId)
      .eq('role_id', roleId)
      .eq('permission_key', permissionKey)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  async listOverridesForRole(
    tenantId: string,
    roleId: string,
  ): Promise<{ permission_key: string; is_granted: boolean }[]> {
    const { data, error } = await this.supabase
      .from('tenant_role_permissions')
      .select('permission_key, is_granted')
      .eq('tenant_id', tenantId)
      .eq('role_id', roleId);

    if (error) throw error;
    return data ?? [];
  }

  async upsertOverride(
    tenantId: string,
    roleId: string,
    permissionKey: string,
    isGranted: boolean,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('tenant_role_permissions')
      .upsert(
        {
          tenant_id: tenantId,
          role_id: roleId,
          permission_key: permissionKey,
          is_granted: isGranted,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'tenant_id,role_id,permission_key' },
      );

    if (error) throw error;
  }

  // Reset means DELETE the override row(s) — never write a row that merely
  // matches the current global default (see S5 Stage C approved decision #3).
  async deleteOverride(tenantId: string, roleId: string, permissionKey: string): Promise<void> {
    const { error } = await this.supabase
      .from('tenant_role_permissions')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('role_id', roleId)
      .eq('permission_key', permissionKey);

    if (error) throw error;
  }

  async deleteAllOverridesForRole(tenantId: string, roleId: string): Promise<void> {
    const { error } = await this.supabase
      .from('tenant_role_permissions')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('role_id', roleId);

    if (error) throw error;
  }
}
