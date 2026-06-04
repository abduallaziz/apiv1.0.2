import { Injectable, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../../shared/supabase/supabase.module';

export interface BillingCustomerRecord {
  id: string;
  tenant_id: string;
  provider: string;
  provider_customer_id: string;
  email: string;
  created_at: string;
  updated_at: string;
}

@Injectable()
export class BillingCustomersRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async findByTenant(tenantId: string, provider: string): Promise<BillingCustomerRecord | null> {
    const { data, error } = await this.supabase
      .from('billing_customers')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('provider', provider)
      .single();

    if (error || !data) return null;
    return data;
  }

  async create(input: {
    tenantId: string;
    provider: string;
    providerCustomerId: string;
    email: string;
  }): Promise<BillingCustomerRecord> {
    const { data, error } = await this.supabase
      .from('billing_customers')
      .insert({
        tenant_id: input.tenantId,
        provider: input.provider,
        provider_customer_id: input.providerCustomerId,
        email: input.email,
      })
      .select()
      .single();

    if (error || !data) throw new Error(`Failed to create billing customer: ${error?.message}`);
    return data;
  }
}