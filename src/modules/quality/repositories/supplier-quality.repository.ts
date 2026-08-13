import { Injectable } from '@nestjs/common';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupplierQualityRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  // v_supplier_quality_scores (migration 168) — computed live, no
  // staleness, no separate stored/refreshed table.
  async findAll(tenantId: string) {
    const { data, error } = await this.supabase
      .from('v_supplier_quality_scores')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('failure_rate_percentage', { ascending: false });
    if (error) throw error;
    return data;
  }

  async findBySupplier(tenantId: string, supplierId: string) {
    const { data, error } = await this.supabase
      .from('v_supplier_quality_scores')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('supplier_id', supplierId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }
}
