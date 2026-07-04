import { Injectable, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../../shared/supabase/supabase.module';

const SELECT = 'id, user_id, name, center_lat, center_lng, radius_m, valid_from, valid_to, created_at';

@Injectable()
export class EmployeeGeofencesRepository {
  constructor(@Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient) {}

  async findAllForUser(tenantId: string, userId: string) {
    const { data, error } = await this.supabase
      .from('employee_geofences')
      .select(SELECT)
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  }

  async create(tenantId: string, dto: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('employee_geofences')
      .insert({ ...dto, tenant_id: tenantId })
      .select(SELECT)
      .single();
    if (error) throw error;
    return data;
  }

  async remove(id: string, tenantId: string) {
    const { error } = await this.supabase
      .from('employee_geofences')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId);
    if (error) throw error;
  }

  async userBelongsToTenant(userId: string, tenantId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('users')
      .select('id')
      .eq('id', userId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw error;
    return !!data;
  }
}
