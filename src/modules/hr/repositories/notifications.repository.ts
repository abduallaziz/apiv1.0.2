import { Injectable, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../../shared/supabase/supabase.module';

// Reuses the existing `notifications` table (already used for billing/payment
// notifications — columns: id, tenant_id, user_id, type, title, body, data,
// channel, is_read, read_at, created_at). Do NOT create a new table with this
// name — an earlier attempt collided with it and aborted a migration.
const SELECT = 'id, title, body, created_at, is_read, read_at';

@Injectable()
export class NotificationsRepository {
  constructor(@Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient) {}

  async findRecentForUser(tenantId: string, userId: string, limit = 3) {
    const { data, error } = await this.supabase
      .from('notifications')
      .select(SELECT)
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data ?? [];
  }
}
