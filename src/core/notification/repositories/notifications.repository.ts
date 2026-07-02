import { Injectable, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../../shared/supabase/supabase.module';

export interface NotificationRecord {
  id: string;
  tenant_id: string | null;
  user_id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  channel: string;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

@Injectable()
export class NotificationsRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: SupabaseClient,
  ) {}

  async findByUser(
    userId: string,
    tenantId: string,
    limit = 20,
    offset = 0,
  ): Promise<{ records: NotificationRecord[]; total: number }> {
    const { data, error, count } = await this.supabase
      .from('notifications')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;
    return { records: data ?? [], total: count ?? 0 };
  }

  async countUnread(userId: string, tenantId: string): Promise<number> {
    const { count, error } = await this.supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('tenant_id', tenantId)
      .eq('is_read', false);

    if (error) throw error;
    return count ?? 0;
  }

  async markAsRead(notificationId: string, userId: string): Promise<void> {
    const { error } = await this.supabase
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('id', notificationId)
      .eq('user_id', userId);

    if (error) throw error;
  }

  async markAllAsRead(userId: string, tenantId: string): Promise<void> {
    const { error } = await this.supabase
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('tenant_id', tenantId)
      .eq('is_read', false);

    if (error) throw error;
  }
}