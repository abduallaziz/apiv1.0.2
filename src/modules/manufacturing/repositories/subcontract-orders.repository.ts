import { ConflictException, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { isUniqueViolation } from '../../../shared/supabase/postgrest-error.util';

function toHttpError(error: unknown): unknown {
  if (isUniqueViolation(error)) {
    return new ConflictException(
      'A subcontract order with this number already exists',
    );
  }
  return error;
}

const LIST_SELECT =
  'id, production_order_id, supplier_id, warehouse_id, order_number, status, sent_at, received_at, notes, created_at, updated_at, ' +
  'suppliers(name), warehouses(name, code)';
const DETAIL_SELECT =
  LIST_SELECT +
  ', lines:subcontract_order_lines(id, material_item_id, material_variant_id, quantity_sent, quantity_returned, material_unit_cost, output_item_id, output_variant_id, output_quantity, output_unit_cost, sent_movement_id, received_movement_id, created_at)';

@Injectable()
export class SubcontractOrdersRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async findAll(tenantId: string, status?: string) {
    let query = this.supabase
      .from('subcontract_orders')
      .select(LIST_SELECT)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    if (status) query = query.eq('status', status);
    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
  }

  async findById(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('subcontract_orders')
      .select(DETAIL_SELECT)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async create(
    tenantId: string,
    createdBy: string | null,
    header: Record<string, unknown>,
    lines: Record<string, unknown>[],
  ) {
    const { data: order, error } = await this.supabase
      .from('subcontract_orders')
      .insert({ ...header, tenant_id: tenantId, created_by: createdBy })
      .select()
      .single();
    if (error) throw toHttpError(error);

    if (lines.length > 0) {
      const { error: linesError } = await this.supabase
        .from('subcontract_order_lines')
        .insert(
          lines.map((line) => ({
            ...line,
            subcontract_order_id: order.id,
            tenant_id: tenantId,
          })),
        );
      if (linesError) throw linesError;
    }

    return this.findById(order.id, tenantId);
  }

  async send(tenantId: string, id: string, actorId: string | null) {
    const { data, error } = await this.supabase.rpc(
      'fn_send_subcontract_materials',
      {
        p_tenant_id: tenantId,
        p_subcontract_order_id: id,
        p_actor_id: actorId,
      },
    );
    if (error) throw error;
    return data;
  }

  async receive(tenantId: string, id: string, actorId: string | null) {
    const { data, error } = await this.supabase.rpc(
      'fn_receive_subcontract_output',
      {
        p_tenant_id: tenantId,
        p_subcontract_order_id: id,
        p_actor_id: actorId,
      },
    );
    if (error) throw error;
    return data;
  }

  async findCosts(subcontractOrderId: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('subcontract_costs')
      .select(
        'id, subcontract_order_id, cost_type, amount, notes, created_by, created_at',
      )
      .eq('subcontract_order_id', subcontractOrderId)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data ?? [];
  }

  async addCost(
    subcontractOrderId: string,
    tenantId: string,
    createdBy: string | null,
    payload: Record<string, unknown>,
  ) {
    const { data, error } = await this.supabase
      .from('subcontract_costs')
      .insert({
        ...payload,
        subcontract_order_id: subcontractOrderId,
        tenant_id: tenantId,
        created_by: createdBy,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }
}
