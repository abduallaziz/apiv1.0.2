import { KitchenService } from './kitchen.service';

describe('KitchenService.getActiveOrders', () => {
  it('drops soft-deleted (removed) items so no orphan tickets appear', async () => {
    const rows = [
      {
        id: 'o1',
        table_id: 't1',
        branch_id: 'b1',
        created_at: 'x',
        tables: { name: 'T1' },
        order_items: [
          {
            id: 'i1',
            item_name: 'A',
            qty: 1,
            kitchen_status: 'pending',
            created_at: 'x',
            deleted_at: null,
          },
          {
            id: 'i2',
            item_name: 'B',
            qty: 1,
            kitchen_status: 'pending',
            created_at: 'x',
            deleted_at: '2026-11-14',
          },
          {
            id: 'i3',
            item_name: 'C',
            qty: 1,
            kitchen_status: 'served',
            created_at: 'x',
            deleted_at: null,
          },
        ],
      },
    ];
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'not', 'order']) q[m] = () => q;
    q.then = (res: (v: unknown) => void) => res({ data: rows, error: null });
    const supabase = { from: () => q };
    const svc = new KitchenService(supabase as never, {} as never);
    const out = await svc.getActiveOrders({ tenantId: 't1' } as never);
    expect(out[0].items.map((i) => i.id)).toEqual(['i1']);
  });
});
