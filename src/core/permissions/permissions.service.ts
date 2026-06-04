import { Injectable, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';

@Injectable()
export class PermissionsService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async hasPermission(role: string, permissionKey: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('role_permissions')
      .select('is_granted')
      .eq('role', role)
      .eq('permission_key', permissionKey)
      .single();

    if (error || !data) return false;
    return data.is_granted === true;
  }

  async getRolePermissions(role: string): Promise<string[]> {
    const { data, error } = await this.supabase
      .from('role_permissions')
      .select('permission_key')
      .eq('role', role)
      .eq('is_granted', true);

    if (error || !data) return [];
    return data.map((row) => row.permission_key);
  }
}