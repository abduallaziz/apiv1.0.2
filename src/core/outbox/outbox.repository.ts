import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';

export interface DomainEventOutboxRow {
  id: string;
  tenant_id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'processing' | 'processed' | 'failed';
  retry_count: number;
  last_error: string | null;
  created_at: string;
  processed_at: string | null;
}

const MAX_RETRIES = 10;

@Injectable()
export class OutboxRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async claimBatch(limit: number): Promise<DomainEventOutboxRow[]> {
    const { data, error } = await this.supabase.rpc('fn_claim_outbox_events', {
      p_limit: limit,
      p_max_retries: MAX_RETRIES,
    });

    if (error) {
      throw error;
    }

    return (data ?? []) as DomainEventOutboxRow[];
  }

  async markProcessed(id: string): Promise<void> {
    const { error } = await this.supabase
      .from('domain_events_outbox')
      .update({ status: 'processed', processed_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      throw error;
    }
  }

  async markFailed(id: string, retryCount: number, errorMessage: string): Promise<void> {
    const { error } = await this.supabase
      .from('domain_events_outbox')
      .update({
        status: 'failed',
        retry_count: retryCount + 1,
        last_error: errorMessage.slice(0, 2000),
      })
      .eq('id', id);

    if (error) {
      throw error;
    }
  }
}
