import { Injectable, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../../shared/supabase/supabase.module';

const SELECT = 'id, title, body, created_at, read_at';

@Injectable()
export class NotificationsRepository {
  constructor(@Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient) {}

  // Personal (user_id match) + broadcast (user_id null) notifications for this tenant.
  async findRecentForUser(tenantId: string, userId: string, limit = 3) {
    const { data, error } = await this.supabase
      .from('notifications')
      .select(SELECT)
      .eq('tenant_id', tenantId)
      .or(`user_id.eq.${userId},user_id.is.null`)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data ?? [];
  }
}
