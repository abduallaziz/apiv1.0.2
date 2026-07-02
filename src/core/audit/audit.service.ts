import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';
import { AuditEntry } from './audit-entry.interface';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async log(entry: AuditEntry): Promise<void> {
    const { error } = await this.supabase
      .from('audit_logs')
      .insert({
        tenant_id: entry.tenant_id,
        actor_id: entry.actor_id,
        actor_role: entry.actor_role,
        action: entry.action,
        resource_type: entry.resource_type,
        resource_id: entry.resource_id ?? null,
        before_data: entry.before_data ?? null,
        after_data: entry.after_data ?? null,
        ip_address: entry.ip_address,
        device: entry.device,
        created_at: new Date().toISOString(),
      });

    if (error) {
      this.logger.error(`Failed to write audit log: ${error.message}`);
    }
  }
}