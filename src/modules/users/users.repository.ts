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
}