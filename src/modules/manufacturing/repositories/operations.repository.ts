import { ConflictException, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { isUniqueViolation } from '../../../shared/supabase/postgrest-error.util';

function toHttpError(error: unknown): unknown {
  if (isUniqueViolation(error)) {
    return new ConflictException(
      'An operation with this sequence already exists on this production order',
    );
  }
  return error;
}

@Injectable()
export class OperationsRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async findByProductionOrder(productionOrderId: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('production_order_operations')
      .select(
        'id, production_order_id, work_center_id, sequence, operation_name, duration_minutes, status, started_at, completed_at, created_at, updated_at, work_centers(name)',
      )
      .eq('production_order_id', productionOrderId)
      .eq('tenant_id', tenantId)
      .order('sequence', { ascending: true });
    if (error) throw error;
    return data ?? [];
  }

  async findById(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('production_order_operations')
      .select(
        'id, production_order_id, work_center_id, sequence, operation_name, duration_minutes, status, started_at, completed_at, created_at, updated_at',
      )
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async create(
    productionOrderId: string,
    tenantId: string,
    payload: Record<string, unknown>,
  ) {
    const { data, error } = await this.supabase
      .from('production_order_operations')
      .insert({
        ...payload,
        production_order_id: productionOrderId,
        tenant_id: tenantId,
      })
      .select()
      .single();
    if (error) throw toHttpError(error);
    return data;
  }

  async update(id: string, tenantId: string, payload: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('production_order_operations')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .maybeSingle();
    if (error) throw toHttpError(error);
    return data;
  }
}
