import { Injectable, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../../shared/supabase/supabase.module';

export interface InvoiceRecord {
  id: string;
  tenant_id: string;
  subscription_id: string | null;
  invoice_number: string;
  currency: string;
  subtotal: number;
  tax_amount: number;
  discount_amount: number;
  total_amount: number;
  status: 'draft' | 'open' | 'paid' | 'void' | 'overdue';
  period_start: string | null;
  period_end: string | null;
  issued_at: string | null;
  due_at: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceItemRecord {
  id: string;
  invoice_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
  metadata_json: Record<string, unknown> | null;
  created_at: string;
}

@Injectable()
export class InvoicesRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async generateInvoiceNumber(tenantId: string): Promise<string> {
    const { count } = await this.supabase
      .from('invoices')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId);

    const seq = ((count ?? 0) + 1).toString().padStart(4, '0');
    const year = new Date().getFullYear();
    const prefix = tenantId.slice(0, 4).toUpperCase();
    return `INV-${prefix}-${year}-${seq}`;
  }

  async create(input: {
    tenantId: string;
    subscriptionId: string | null;
    currency: string;
    subtotal: number;
    taxAmount: number;
    discountAmount: number;
    totalAmount: number;
    periodStart?: Date;
    periodEnd?: Date;
    dueAt?: Date;
    items: Array<{
      description: string;
      quantity: number;
      unitPrice: number;
      amount: number;
      metadata?: Record<string, unknown>;
    }>;
  }): Promise<InvoiceRecord> {
    const invoiceNumber = await this.generateInvoiceNumber(input.tenantId);
    const now = new Date().toISOString();

    const { data: invoice, error } = await this.supabase
      .from('invoices')
      .insert({
        tenant_id: input.tenantId,
        subscription_id: input.subscriptionId,
        invoice_number: invoiceNumber,
        currency: input.currency,
        subtotal: input.subtotal,
        tax_amount: input.taxAmount,
        discount_amount: input.discountAmount,
        total_amount: input.totalAmount,
        status: 'open',
        period_start: input.periodStart?.toISOString() ?? null,
        period_end: input.periodEnd?.toISOString() ?? null,
        issued_at: now,
        due_at: input.dueAt?.toISOString() ?? null,
      })
      .select()
      .single();

    if (error || !invoice) throw new Error(`Failed to create invoice: ${error?.message}`);

    if (input.items.length > 0) {
      const { error: itemsError } = await this.supabase
        .from('invoice_items')
        .insert(
          input.items.map((item) => ({
            invoice_id: invoice.id,
            description: item.description,
            quantity: item.quantity,
            unit_price: item.unitPrice,
            amount: item.amount,
            metadata_json: item.metadata ?? null,
          })),
        );

      if (itemsError) throw new Error(`Failed to create invoice items: ${itemsError.message}`);
    }

    return invoice;
  }

  async markPaid(invoiceId: string): Promise<void> {
    const { error } = await this.supabase
      .from('invoices')
      .update({
        status: 'paid',
        paid_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', invoiceId);

    if (error) throw new Error(`Failed to mark invoice paid: ${error.message}`);
  }

  async markOverdue(invoiceId: string): Promise<void> {
    const { error } = await this.supabase
      .from('invoices')
      .update({
        status: 'overdue',
        updated_at: new Date().toISOString(),
      })
      .eq('id', invoiceId);

    if (error) throw new Error(`Failed to mark invoice overdue: ${error.message}`);
  }

  async findByTenant(
    tenantId: string,
    limit = 20,
    offset = 0,
  ): Promise<{ data: InvoiceRecord[]; count: number }> {
    const { data, error, count } = await this.supabase
      .from('invoices')
      .select('*', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw new Error(error.message);
    return { data: data ?? [], count: count ?? 0 };
  }

  async findById(invoiceId: string, tenantId: string): Promise<InvoiceRecord | null> {
    const { data, error } = await this.supabase
      .from('invoices')
      .select('*')
      .eq('id', invoiceId)
      .eq('tenant_id', tenantId)
      .single();

    if (error || !data) return null;
    return data;
  }

  async findItemsByInvoice(invoiceId: string): Promise<InvoiceItemRecord[]> {
    const { data, error } = await this.supabase
      .from('invoice_items')
      .select('*')
      .eq('invoice_id', invoiceId)
      .order('created_at', { ascending: true });

    if (error) throw new Error(error.message);
    return data ?? [];
  }
}