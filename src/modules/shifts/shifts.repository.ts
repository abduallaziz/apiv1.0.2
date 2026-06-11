import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';

@Injectable()
export class ShiftsRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async findAll(tenantId: string | null, branchId?: string) {
  let query = this.supabase
    .from('shifts')
    .select('id, status, opening_cash, closing_cash, discrepancy, expected_cash, opened_at, closed_at, cashier_id, branch_id, users!cashier_id(name)')
    .is('deleted_at', null)
    .order('opened_at', { ascending: false });

  if (tenantId) query = query.eq('tenant_id', tenantId);
  if (branchId) query = query.eq('branch_id', branchId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((s: any) => ({
  ...s,
  cashier_name: s.users?.name ?? null,
  users: undefined,
}));
}

  async findOpenByUser(cashierId: string, tenantId: string) {
    const { data } = await this.supabase
      .from('shifts')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('cashier_id', cashierId)
      .eq('status', 'open')
      .is('deleted_at', null)
      .maybeSingle();
    return data;
  }

  async findById(id: string, tenantId: string) {
    const { data } = await this.supabase
      .from('shifts')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle();
    return data;
  }

  async create(payload: {
    tenant_id: string;
    branch_id: string;
    cashier_id: string;
    opening_cash: number;
    notes?: string;
  }) {
    const { data, error } = await this.supabase
      .from('shifts')
      .insert({
        ...payload,
        status: 'open',
        opened_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async close(
    id: string,
    tenantId: string,
    payload: {
      closing_cash: number;
      expected_cash: number;
      discrepancy: number;
      notes?: string;
    },
  ) {
    const { data, error } = await this.supabase
      .from('shifts')
      .update({
        status: 'closed',
        closing_cash: payload.closing_cash,
        expected_cash: payload.expected_cash,
        discrepancy: payload.discrepancy,
        closed_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async getShiftInvoices(shiftId: string, tenantId: string) {
    const { data } = await this.supabase
      .from('orders')
      .select('total, payment_method')
      .eq('shift_id', shiftId)
      .eq('tenant_id', tenantId)
      .eq('status', 'completed');
    return data ?? [];
  }

  async getShiftExpenses(shiftId: string, tenantId: string) {
    const { data } = await this.supabase
      .from('expenses')
      .select('amount, status')
      .eq('shift_id', shiftId)
      .eq('tenant_id', tenantId);
    return data ?? [];
  }

  async findCurrentByBranch(branchId: string, tenantId: string) {
    const { data } = await this.supabase
      .from('shifts')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('branch_id', branchId)
      .eq('status', 'open')
      .is('deleted_at', null)
      .order('opened_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return data;
  }
}