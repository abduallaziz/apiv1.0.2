// Row shapes returned by the (untyped) Supabase client for the customers module.
// Repositories type results to these once, at the boundary, so services stay fully typed.

export interface CustomerFieldDefinitionRow {
  id: string;
  field_key: string;
  label_ar: string | null;
  label_en: string | null;
  field_type: string;
  options: { value: string; label_ar: string; label_en: string }[] | null;
  required: boolean;
  is_active: boolean;
  sort_order: number | null;
  contact_role: string | null;
  created_at: string;
  [key: string]: unknown;
}

export interface CustomerRow {
  id: string;
  tenant_id?: string | null;
  full_name: string;
  phone: string | null;
  phone_normalized?: string | null;
  email: string | null;
  plate_number?: string | null;
  visit_date?: string | null;
  odometer?: number | null;
  loyalty_points: number;
  is_active: boolean;
  custom_fields: Record<string, unknown> | null;
  created_at: string;
  [key: string]: unknown;
}

export interface IdRow {
  id: string;
}

export interface CustomerVehicleRow {
  id: string;
  customer_id: string;
  plate: string;
  plate_normalized?: string | null;
  size: string | null;
  model?: string | null;
  colour?: string | null;
  created_at?: string;
  [key: string]: unknown;
}

export interface OrderTotalRow {
  customer_id: string;
  total: number | null;
}

export interface OrderHistoryRow {
  id: string;
  total: number | null;
  payment_method: string | null;
  status: string;
  created_at: string;
}

export interface OrderItemQtyRow {
  order_id: string;
  qty: number | null;
}
