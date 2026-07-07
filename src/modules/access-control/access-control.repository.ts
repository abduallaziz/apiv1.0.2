import { Injectable, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';

export interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  tenant_id: string | null;
  is_system: boolean;
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

    return (data ?? []).map((row: any) => ({
      id: row.id,
      name: row.name,
      resource: row.resource,
      action: row.action,
      description: row.description,
      group_id: row.group_id,
      group_code: row.permission_groups?.code ?? null,
    }));
  }

  // System roles (tenant_id IS NULL) + this tenant's own custom roles (none
  // exist yet, but the query already generalizes — see S5 architecture review).
  async listRolesForTenant(tenantId: string): Promise<RoleRow[]> {
    const { data, error } = await this.supabase
      .from('roles')
      .select('id, name, description, tenant_id, is_system')
      .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
      .order('name', { ascending: true });

    if (error) throw error;
    return data ?? [];
  }

  async getRoleById(roleId: string): Promise<RoleRow | null> {
    const { data, error } = await this.supabase
      .from('roles')
      .select('id, name, description, tenant_id, is_system')
      .eq('id', roleId)
      .maybeSingle();

    if (error) throw error;
    return data;
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

  async countUsersForRole(roleId: string, tenantId: string): Promise<number> {
    const { count, error } = await this.supabase
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('role_id', roleId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null);

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
