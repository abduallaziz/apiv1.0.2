import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';
import { TemplateKind } from './print.types';

const col = (kind: TemplateKind) =>
  kind === 'invoice' ? 'invoice_template' : 'kitchen_template';

@Injectable()
export class PrintRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async getTenant(tenantId: string) {
    const { data, error } = await this.supabase
      .from('tenants')
      .select(
        'id, name, logo_url, address, phone, tax_number, invoice_footer, tax_rate, tax_inclusive_pricing, currency_symbol, printer_settings, invoice_template, kitchen_template',
      )
      .eq('id', tenantId)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async getBranch(tenantId: string, branchId: string) {
    const { data, error } = await this.supabase
      .from('branches')
      .select('id, name, address, invoice_template, kitchen_template')
      .eq('tenant_id', tenantId)
      .eq('id', branchId)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async listBranchTemplates(tenantId: string, kind: TemplateKind) {
    const { data, error } = await this.supabase
      .from('branches')
      .select(`id, name, ${col(kind)}`)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .order('name');
    if (error) throw error;
    return (data ?? []) as unknown as Record<string, unknown>[];
  }

  async saveTenantTemplate(
    tenantId: string,
    kind: TemplateKind,
    template: object,
  ) {
    const { error } = await this.supabase
      .from('tenants')
      .update({ [col(kind)]: template })
      .eq('id', tenantId);
    if (error) throw error;
  }

  /** template=null clears the override (branch falls back to the tenant template). */
  async saveBranchTemplate(
    tenantId: string,
    branchId: string,
    kind: TemplateKind,
    template: object | null,
  ): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('branches')
      .update({ [col(kind)]: template })
      .eq('tenant_id', tenantId)
      .eq('id', branchId)
      .is('deleted_at', null)
      .select('id');
    if (error) throw error;
    return (data ?? []).length > 0;
  }

  async getOrder(tenantId: string, orderId: string) {
    const { data, error } = await this.supabase
      .from('orders')
      .select(
        'id, invoice_no, branch_id, cashier_id, customer_id, table_id, status, subtotal, discount, tax, total, payment_method, cash_amount, card_amount, notes, created_at',
      )
      .eq('tenant_id', tenantId)
      .eq('id', orderId)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async getOrderItems(orderId: string) {
    const { data, error } = await this.supabase
      .from('order_items')
      .select(
        'id, item_name, variant_name, qty, price, total_price, kitchen_status, created_at',
      )
      .eq('order_id', orderId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data ?? [];
  }

  async getCashierName(tenantId: string, userId: string | null) {
    if (!userId) return null;
    const { data, error } = await this.supabase
      .from('users')
      .select('name')
      .eq('tenant_id', tenantId)
      .eq('id', userId)
      .maybeSingle();
    if (error) throw error;
    return (data?.name as string | undefined) ?? null;
  }

  async getCustomer(tenantId: string, customerId: string | null) {
    if (!customerId) return null;
    const { data, error } = await this.supabase
      .from('customers')
      .select('full_name, phone, plate_number')
      .eq('tenant_id', tenantId)
      .eq('id', customerId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async getTableName(tenantId: string, tableId: string | null) {
    if (!tableId) return null;
    const { data, error } = await this.supabase
      .from('tables')
      .select('name')
      .eq('tenant_id', tenantId)
      .eq('id', tableId)
      .maybeSingle();
    if (error) throw error;
    return (data?.name as string | undefined) ?? null;
  }
}
