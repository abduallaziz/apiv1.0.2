import { Injectable, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../../shared/supabase/supabase.module';

export interface PaymentRecord {
  id: string;
  tenant_id: string;
  invoice_id: string;
  provider: string;
  provider_payment_id: string | null;
  amount: number;
  currency: string;
  status: 'pending' | 'succeeded' | 'failed' | 'refunded';
  paid_at: string | null;
  failure_reason: string | null;
  metadata_json: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

@Injectable()
export class PaymentsRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async create(input: {
    tenantId: string;
    invoiceId: string;
    provider: string;
    amount: number;
    currency: string;
  }): Promise<PaymentRecord> {
    const { data, error } = await this.supabase
      .from('payments')
      .insert({
        tenant_id: input.tenantId,
        invoice_id: input.invoiceId,
        provider: input.provider,
        amount: input.amount,
        currency: input.currency,
        status: 'pending',
      })
      .select()
      .single();

    if (error || !data) throw new Error(`Failed to create payment: ${error?.message}`);
    return data;
  }

  async updateStatus(
    paymentId: string,
    status: 'pending' | 'succeeded' | 'failed' | 'refunded',
    extra?: {
      providerPaymentId?: string;
      failureReason?: string;
      paidAt?: Date;
    },
  ): Promise<void> {
    const { error } = await this.supabase
      .from('payments')
      .update({
        status,
        provider_payment_id: extra?.providerPaymentId ?? null,
        failure_reason: extra?.failureReason ?? null,
        paid_at: extra?.paidAt?.toISOString() ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', paymentId);

    if (error) throw new Error(`Failed to update payment: ${error.message}`);
  }

  async findByTenant(
    tenantId: string,
    limit = 20,
    offset = 0,
  ): Promise<{ data: PaymentRecord[]; count: number }> {
    const { data, error, count } = await this.supabase
      .from('payments')
      .select('*', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw new Error(error.message);
    return { data: data ?? [], count: count ?? 0 };
  }

  async findByInvoice(invoiceId: string): Promise<PaymentRecord[]> {
    const { data, error } = await this.supabase
      .from('payments')
      .select('*')
      .eq('invoice_id', invoiceId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return data ?? [];
  }
}