import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';
import { DineInRepository } from './repositories/dine-in.repository';
import { TenantContext } from '../../core/tenant/tenant-context';

const VALID_STATUSES = ['pending', 'preparing', 'ready', 'served'];

@Injectable()
export class KitchenService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
    private readonly dineInRepo: DineInRepository,
  ) {}

  async getActiveOrders(tenant: TenantContext, branchId?: string) {
    let q = this.supabase
      .from('orders')
      .select('id, table_id, branch_id, created_at, tables(name), order_items(id, item_name, qty, kitchen_status, created_at)')
      .eq('tenant_id', tenant.tenantId)
      .eq('status', 'pending')
      .not('table_id', 'is', null)
      .order('created_at', { ascending: true });
    if (branchId) q = q.eq('branch_id', branchId);

    const { data, error } = await q;
    if (error) throw error;

    return (data ?? []).map((o: any) => ({
      order_id: o.id,
      table_id: o.table_id,
      table_name: o.tables?.name ?? null,
      created_at: o.created_at,
      items: (o.order_items ?? [])
        .filter((i: any) => i.kitchen_status && i.kitchen_status !== 'served')
        .map((i: any) => ({
          id: i.id,
          item_name: i.item_name,
          qty: i.qty,
          kitchen_status: i.kitchen_status,
          created_at: i.created_at,
        })),
    }));
  }

  async updateItemStatus(tenant: TenantContext, itemId: string, status: string) {
    if (!VALID_STATUSES.includes(status)) {
      throw new BadRequestException(`status must be one of: ${VALID_STATUSES.join(', ')}`);
    }
    const updated = await this.dineInRepo.updateItemKitchenStatus(itemId, tenant.tenantId, status);
    if (!updated) throw new NotFoundException('Order item not found');
    return updated;
  }
}
