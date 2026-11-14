// Row shapes returned by the (untyped) Supabase client for the tables / dine-in module.
// The repositories cast to these once, at the boundary, so the services stay fully typed.

export interface TableRow {
  id: string;
  branch_id: string;
  name: string;
  capacity: number | null;
  status: string;
  created_at: string;
}

export interface DineInOrderRow {
  id: string;
  branch_id: string;
  cashier_id: string | null;
  table_id: string | null;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  status: string;
  created_at: string;
}

export interface DineInItemRow {
  id: string;
  item_id: string;
  item_name: string;
  qty: number;
  price: number;
  total_price: number;
  variant_id: string | null;
  variant_name: string | null;
  kitchen_status: string | null;
  created_at: string;
}

export interface ReservationRow {
  id: string;
  table_id: string;
  customer_name: string;
  customer_phone: string | null;
  party_size: number | null;
  reservation_time: string;
  status: string;
  notes: string | null;
  created_at: string;
  tables?: { name: string } | null;
}

export type Reservation = Omit<ReservationRow, 'tables'> & {
  table_name: string | null;
  tables: undefined;
};

export interface KitchenOrderRow {
  id: string;
  table_id: string | null;
  branch_id: string;
  created_at: string;
  tables: { name: string } | null;
  order_items: {
    id: string;
    item_name: string;
    qty: number;
    kitchen_status: string | null;
    created_at: string;
  }[];
}
