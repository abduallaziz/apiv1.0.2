import { Injectable, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';
import { ScopedRepository } from '../../core/tenant/scoped.repository';
import { TenantContext } from '../../core/tenant/tenant.context';

@Injectable()
export class UsersRepository extends ScopedRepository {
  constructor(@Inject(SUPABASE_CLIENT) supabase: SupabaseClient) {
    super(supabase);
  }

  private static readonly PAYROLL_FIELDS =
    'base_salary, grace_period_minutes, late_deduction_mode, late_deduction_value, attendance_token, attendance_device_fingerprint, attendance_enabled, shift_pattern_id, custom_days_of_week, custom_shifts, custom_day_overrides, schedule_start_date, department, job_title, avatar_url, employee_number, phone, identity_number, manager_name, employment_type, join_date, city, address, gps_radius_meters, is_employee_profile';

  async findAll(tenant: TenantContext) {
    return this.scopedQuery('users', tenant)
      .select(`id, email, name, role, is_active, commission_rate, created_at, ${UsersRepository.PAYROLL_FIELDS}`)
      .order('created_at', { ascending: false });
  }

  async findById(id: string, tenant: TenantContext) {
    return this.scopedQuery('users', tenant)
      .select(`id, email, name, role, is_active, commission_rate, created_at, ${UsersRepository.PAYROLL_FIELDS}`)
      .eq('id', id)
      .single();
  }

  async findByEmail(email: string, tenantId: string) {
    return this.supabase
      .from('users')
      .select('id, email, name, role, is_active, commission_rate')
      .eq('email', email)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .single();
  }

  async findByPhone(phone: string, tenantId: string) {
    return this.supabase
      .from('users')
      .select('id, name')
      .eq('phone', phone)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle();
  }

  async findByEmployeeNumber(employeeNumber: string, tenantId: string) {
    return this.supabase
      .from('users')
      .select('id, name')
      .eq('employee_number', employeeNumber)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle();
  }

  // Employees page — only rows explicitly flagged as having an Employee Core
  // profile. A System User with a real login can exist without ever appearing
  // here (see 058_employee_profile_flag.sql).
  async findAllEmployees(tenant: TenantContext) {
    return this.scopedQuery('users', tenant)
      .select(`id, email, name, role, is_active, commission_rate, created_at, ${UsersRepository.PAYROLL_FIELDS}`)
      .eq('is_employee_profile', true)
      .order('created_at', { ascending: false });
  }

  // Candidates for "Link existing System User" — has real login (role != none)
  // but no Employee Core profile yet.
  async findLinkableSystemUsers(tenant: TenantContext) {
    return this.scopedQuery('users', tenant)
      .select('id, name, email, role')
      .eq('is_employee_profile', false)
      .neq('role', 'none')
      .order('name', { ascending: true });
  }

  async linkAsEmployee(id: string, tenantId: string) {
    return this.supabase
      .from('users')
      .update({ is_employee_profile: true })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select(`id, email, name, role, is_active, commission_rate, ${UsersRepository.PAYROLL_FIELDS}`)
      .single();
  }

  async countActive(tenant: TenantContext) {
    return this.supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenant.tenantId)
      .is('deleted_at', null);
  }

  async create(data: Record<string, any>) {
    return this.supabase
      .from('users')
      .insert(data)
      .select(`id, email, name, role, is_active, commission_rate, created_at, ${UsersRepository.PAYROLL_FIELDS}`)
      .single();
  }

  async update(id: string, tenantId: string, data: Record<string, any>) {
    return this.supabase
      .from('users')
      .update(data)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select(`id, email, name, role, is_active, commission_rate, ${UsersRepository.PAYROLL_FIELDS}`)
      .single();
  }

  // Only resolves system roles (tenant_id IS NULL) — changeRole()'s DTO is
  // typed to the fixed UserRole enum, never a custom tenant role, so this
  // mirrors that same scope rather than silently accepting one.
  async findSystemRoleId(roleName: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('roles')
      .select('id')
      .eq('name', roleName)
      .is('tenant_id', null)
      .maybeSingle();

    if (error || !data) return null;
    return data.id;
  }

  // user_roles is the source of truth going forward — users.role/role_id
  // stay in sync as a legacy mirror (see changeRole()), but this is what
  // guards/PermissionsService.hasPermissionForUser actually reads. Swaps
  // whichever role was is_primary for this user to the new one; upsert
  // (not plain insert) so re-assigning a role the user already held via a
  // future Phase-3 multi-role grant doesn't collide with the UNIQUE
  // (user_id, role_id) constraint.
  // Phase 3 — full role listing for the user-detail "Roles" panel. Not
  // tenant-scoped by a query filter (user_roles has no tenant_id column of
  // its own); callers must first confirm the user belongs to the caller's
  // tenant via findOne()/findById(), same as changeRole() already does.
  async findUserRoles(userId: string) {
    const { data, error } = await this.supabase
      .from('user_roles')
      .select('id, role_id, is_primary, created_at, role:roles!user_roles_role_id_fkey(id, name, description, is_system)')
      .eq('user_id', userId)
      .order('is_primary', { ascending: false });
    if (error) throw error;
    return data ?? [];
  }

  async countUserRoles(userId: string): Promise<number> {
    const { count, error } = await this.supabase
      .from('user_roles')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);
    if (error) throw error;
    return count ?? 0;
  }

  // Resolves a role for the addRole()/removeRole() write path — accepts a
  // system role (tenant_id IS NULL, usable by every tenant) or this
  // tenant's own custom role, exactly the same accessibility rule
  // AccessControlService.getAccessibleRoleOrThrow() applies on the
  // access-control side, kept here rather than cross-importing that
  // module's service into UsersService for one lookup.
  async findAccessibleRole(roleId: string, tenantId: string): Promise<{ id: string; tenant_id: string | null; name: string } | null> {
    const { data, error } = await this.supabase
      .from('roles')
      .select('id, tenant_id, name')
      .eq('id', roleId)
      .maybeSingle();
    if (error || !data) return null;
    if (data.tenant_id !== null && data.tenant_id !== tenantId) return null;
    return data;
  }

  async insertUserRole(userId: string, roleId: string, isPrimary: boolean): Promise<void> {
    const { error } = await this.supabase
      .from('user_roles')
      .insert({ user_id: userId, role_id: roleId, is_primary: isPrimary });
    if (error) throw error;
  }

  async deleteUserRole(userId: string, roleId: string): Promise<void> {
    const { error } = await this.supabase
      .from('user_roles')
      .delete()
      .eq('user_id', userId)
      .eq('role_id', roleId);
    if (error) throw error;
  }

  async syncPrimaryRole(userId: string, roleId: string): Promise<void> {
    const { error: clearError } = await this.supabase
      .from('user_roles')
      .delete()
      .eq('user_id', userId)
      .eq('is_primary', true)
      .neq('role_id', roleId);
    if (clearError) throw clearError;

    const { error: upsertError } = await this.supabase
      .from('user_roles')
      .upsert(
        { user_id: userId, role_id: roleId, is_primary: true },
        { onConflict: 'user_id,role_id' },
      );
    if (upsertError) throw upsertError;
  }

  async generateAttendanceToken(id: string, tenantId: string) {
    const token = randomBytes(24).toString('base64url');
    const { data, error } = await this.supabase
      .from('users')
      .update({ attendance_token: token, attendance_device_fingerprint: null, attendance_enabled: true })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select('id, attendance_token, attendance_enabled')
      .single();
    if (error) throw error;
    return data;
  }

  async unbindAttendanceDevice(id: string, tenantId: string) {
    const { error } = await this.supabase
      .from('users')
      .update({ attendance_device_fingerprint: null })
      .eq('id', id)
      .eq('tenant_id', tenantId);
    if (error) throw error;
  }

  async findByAttendanceToken(token: string) {
    const { data, error } = await this.supabase
      .from('users')
      .select('id, tenant_id, name, job_title, annual_leave_balance, attendance_device_fingerprint, tenants(name, logo_url)')
      .eq('attendance_token', token)
      .eq('is_active', true)
      .eq('attendance_enabled', true)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  // Disabling or soft-deleting an employee must immediately cut off their personal
  // attendance link and force any bound device to re-bind — clears both in one
  // write so a disabled employee can't check in even if their token leaks.
  async revokeAttendanceAccess(id: string, tenantId: string) {
    const { error } = await this.supabase
      .from('users')
      .update({ attendance_token: null, attendance_device_fingerprint: null })
      .eq('id', id)
      .eq('tenant_id', tenantId);
    if (error) throw error;
  }

  async bindAttendanceDevice(id: string, fingerprint: string) {
    const { error } = await this.supabase
      .from('users')
      .update({ attendance_device_fingerprint: fingerprint })
      .eq('id', id);
    if (error) throw error;
  }

  async softDelete(id: string, tenantId: string) {
    return this.supabase
      .from('users')
      .update({ deleted_at: new Date().toISOString(), is_active: false })
      .eq('id', id)
      .eq('tenant_id', tenantId);
  }

  // History tab — reuses the existing audit_logs table (see core/audit), scoped
  // to this employee's row as resource_id. No new table, no schema change.
  async findHistory(id: string, tenantId: string, limit = 50) {
    const { data, error } = await this.supabase
      .from('audit_logs')
      .select('id, actor_id, actor_role, action, resource_type, before_data, after_data, created_at')
      .eq('tenant_id', tenantId)
      .eq('resource_id', id)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data ?? [];
  }
}