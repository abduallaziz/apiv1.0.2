import { Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';
import { TenantContext } from './tenant.context';

export abstract class ScopedRepository {
  protected readonly supabase: SupabaseClient;

  constructor(@Inject(SUPABASE_CLIENT) supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  protected scopedQuery(table: string, tenant: TenantContext) {
    const query = this.supabase
      .from(table)
      .select('*')
      .is('deleted_at', null);

    if (tenant.tenantId) {
      return query.eq('tenant_id', tenant.tenantId);
    }

    // superadmin — no tenant filter
    return query;
  }

  protected unscopedQuery(table: string) {
    return this.supabase
      .from(table)
      .select('*')
      .is('deleted_at', null);
  }
}