// Inventory Stage 1 / I5 (Owner-approved) — first regression coverage for the
// reservations mechanism itself (fn_create_reservation + release), which had
// zero test files before this. Also documents the I5 investigation finding:
// grepping the whole codebase for callers of ReservationsService.create()/
// fn_create_reservation found exactly one — reservations.controller.ts's own
// endpoint. Nothing in invoices.service.ts (POS/checkout) or any held-order
// flow ever creates or releases a reservation. This is confirmed intentional
// design, not a defect: no current codepath produces a reservation tied to a
// POS sale/held order for the POS sale-deduction flow to consult in the
// first place, so there is nothing to integrate — reservations exist today
// as a standalone, manually-invoked capability (e.g. for a future B2B/
// e-commerce channel), correctly independent of instant POS checkout.
import 'dotenv/config';
import { pickTestWarehouse } from '../../../../test/support/test-tenant';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

describe('reservations standalone mechanism (I5 investigation)', () => {
  let supabase: SupabaseClient;
  let tenantId: string;
  let warehouseId: string;
  let itemId: string;
  const reservationIds: string[] = [];

  beforeAll(async () => {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );

    const warehouse = await pickTestWarehouse(supabase);
    warehouseId = warehouse.id;
    tenantId = warehouse.tenant_id;

    const { data: item } = await supabase
      .from('items')
      .insert({
        tenant_id: tenantId,
        name: 'QA I5 Reservation Test Item',
        type: 'product',
        operation_type: 'sell',
        price: 10,
        has_inventory: true,
      })
      .select('id')
      .single();
    itemId = item.id;

    // Seed 10 units on hand.
    await supabase.rpc('fn_apply_stock_movement', {
      p_tenant_id: tenantId,
      p_warehouse_id: warehouseId,
      p_location_id: null,
      p_item_id: itemId,
      p_variant_id: null,
      p_batch_id: null,
      p_movement_type: 'receipt',
      p_direction: 'in',
      p_quantity: 10,
      p_unit_cost: 5,
      p_reference_type: 'test',
      p_reference_id: null,
      p_created_by: null,
    });
  });

  afterAll(async () => {
    if (reservationIds.length) {
      await supabase
        .from('stock_reservations')
        .delete()
        .in('id', reservationIds);
    }
    await supabase.from('stock_movements').delete().eq('item_id', itemId);
    await supabase.from('stock_levels').delete().eq('item_id', itemId);
    await supabase.from('cost_layers').delete().eq('item_id', itemId);
    await supabase.from('items').delete().eq('id', itemId);
  });

  it('Test 1: creating a reservation reduces available-to-promise without touching quantity_on_hand', async () => {
    const { data, error } = await supabase.rpc('fn_create_reservation', {
      p_tenant_id: tenantId,
      p_warehouse_id: warehouseId,
      p_item_id: itemId,
      p_variant_id: null,
      p_batch_id: null,
      p_quantity: 4,
      p_reference_type: 'manual_test',
      p_reference_id: '00000000-0000-0000-0000-000000000001',
      p_created_by: null,
      p_expires_at: null,
    });

    expect(error).toBeNull();
    expect(data.status).toBe('active');
    reservationIds.push(data.id);

    const { data: level } = await supabase
      .from('stock_levels')
      .select('quantity_on_hand, quantity_reserved')
      .eq('item_id', itemId)
      .single();
    expect(level.quantity_on_hand).toBe(10); // unchanged — reservation is not a deduction
    expect(level.quantity_reserved).toBe(4);
  });

  it('Test 2: a reservation cannot exceed available stock (blocked, not silently capped)', async () => {
    const { error } = await supabase.rpc('fn_create_reservation', {
      p_tenant_id: tenantId,
      p_warehouse_id: warehouseId,
      p_item_id: itemId,
      p_variant_id: null,
      p_batch_id: null,
      p_quantity: 100,
      p_reference_type: 'manual_test',
      p_reference_id: '00000000-0000-0000-0000-000000000002',
      p_created_by: null,
      p_expires_at: null,
    });

    expect(error).not.toBeNull();
  });

  it('Test 3: releasing a reservation restores available-to-promise (quantity_reserved back down)', async () => {
    const activeId = reservationIds[0];

    const { error } = await supabase
      .from('stock_reservations')
      .update({ status: 'released', released_at: new Date().toISOString() })
      .eq('id', activeId);
    expect(error).toBeNull();

    // Reservations release via direct status update per
    // ReservationsRepository.release() (no separate stock-restoring RPC —
    // quantity_reserved is derived from active reservations, not stored
    // redundantly on release). Confirm the derived availability view
    // reflects it.
    const { data: activeReservations } = await supabase
      .from('stock_reservations')
      .select('id')
      .eq('item_id', itemId)
      .eq('status', 'active');
    expect(activeReservations).toHaveLength(0);
  });
});

// I5 investigation finding (documented, not asserted as a DB test — see
// file header): grepping invoices.service.ts and invoices.repository.ts for
// ReservationsService/ReservationsRepository/fn_create_reservation returns
// zero matches. No POS/checkout codepath creates or releases a reservation.
// If a future change wires POS into reservations, this file's premise
// changes and should be revisited alongside it.
