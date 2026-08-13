import { Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';

// Minimal read path only — Phase 4 needs session validation for event
// ingestion, not session lifecycle management. Full session CRUD (start/
// end a workflow session) belongs to whichever later phase actually needs
// it (Mobile Scanner App / Frontend Control Center); not duplicated here.
@Injectable()
export class SessionsRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async findById(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('scanner_sessions')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }
}
