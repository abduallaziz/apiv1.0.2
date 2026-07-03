import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import * as bcrypt from 'bcryptjs';
import { SUPABASE_CLIENT } from '../../../shared/supabase/supabase.module';

@Injectable()
export class AuthControlService {
  constructor(@Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient) {}

  async getTenantOptions() {
    const { data, error } = await this.supabase
      .from('tenants')
      .select('id, name')
      .is('deleted_at', null)
      .order('name', { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async getTenantUsers(tenantId: string) {
    const { data, error } = await this.supabase
      .from('users')
      .select('id, name, email, role, is_active, created_at, deleted_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async resetPassword(userId: string, newPassword: string): Promise<{ success: true }> {
    const password_hash = await bcrypt.hash(newPassword, 12);
    const { error, count } = await this.supabase
      .from('users')
      .update({ password_hash, updated_at: new Date().toISOString() }, { count: 'exact' })
      .eq('id', userId);
    if (error) throw new Error(error.message);
    if (!count) throw new NotFoundException('User not found');
    return { success: true };
  }

  async changeRole(userId: string, role: string): Promise<{ success: true }> {
    const { error, count } = await this.supabase
      .from('users')
      .update({ role, updated_at: new Date().toISOString() }, { count: 'exact' })
      .eq('id', userId);
    if (error) throw new Error(error.message);
    if (!count) throw new NotFoundException('User not found');
    return { success: true };
  }

  async toggleActive(userId: string, isActive: boolean): Promise<{ success: true }> {
    const { error, count } = await this.supabase
      .from('users')
      .update({ is_active: isActive, updated_at: new Date().toISOString() }, { count: 'exact' })
      .eq('id', userId);
    if (error) throw new Error(error.message);
    if (!count) throw new NotFoundException('User not found');
    return { success: true };
  }

  async getSessions(filters: { tenantId?: string; userId?: string }) {
    let query = this.supabase
      .from('device_sessions')
      .select('*, users(name, email), tenants(name)')
      .order('last_active_at', { ascending: false });

    if (filters.tenantId) query = query.eq('tenant_id', filters.tenantId);
    if (filters.userId) query = query.eq('user_id', filters.userId);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    return (data ?? []).map((row: any) => ({
      id: row.id,
      user_id: row.user_id,
      user_name: row.users?.name ?? null,
      user_email: row.users?.email ?? null,
      tenant_id: row.tenant_id,
      tenant_name: row.tenants?.name ?? null,
      device_name: row.device_name,
      device_type: row.device_type,
      ip_address: row.ip_address,
      last_active_at: row.last_active_at,
      is_revoked: row.is_revoked,
      created_at: row.created_at,
    }));
  }

  async revokeSession(sessionId: string): Promise<{ success: true }> {
    const { error, count } = await this.supabase
      .from('device_sessions')
      .update({ is_revoked: true }, { count: 'exact' })
      .eq('id', sessionId);
    if (error) throw new Error(error.message);
    if (!count) throw new NotFoundException('Session not found');
    return { success: true };
  }

  async revokeAllUserSessions(userId: string): Promise<{ success: true }> {
    const { error } = await this.supabase
      .from('device_sessions')
      .update({ is_revoked: true })
      .eq('user_id', userId)
      .eq('is_revoked', false);
    if (error) throw new Error(error.message);
    return { success: true };
  }
}
