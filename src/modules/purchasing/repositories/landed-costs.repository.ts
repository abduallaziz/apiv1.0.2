import { Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class LandedCostsRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async findByReceipt(goodsReceiptId: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('landed_costs')
      .select(
        'id, goods_receipt_id, cost_type, amount, allocation_method, notes, created_by, created_at',
      )
      .eq('goods_receipt_id', goodsReceiptId)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data ?? [];
  }

  async create(
    goodsReceiptId: string,
    tenantId: string,
    createdBy: string,
    payload: Record<string, unknown>,
  ) {
    const { data, error } = await this.supabase
      .from('landed_costs')
      .insert({
        ...payload,
        goods_receipt_id: goodsReceiptId,
        tenant_id: tenantId,
        created_by: createdBy,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }
}
