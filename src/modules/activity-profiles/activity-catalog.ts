/**
 * Built-in activity catalog. Mirrors the seed of `activity_definitions`
 * (migration 264, pending). It is the fallback used until that table exists,
 * and the single reference the consistency test compares the SQL seed against.
 * Defaults are provisional per section (owner decision D8 refines them).
 */
export type ActivityWorkflow =
  | 'instant'
  | 'table_kitchen'
  | 'queue'
  | 'work_order'
  | 'appointment';
export type ActivityStockMode =
  | 'none'
  | 'qty'
  | 'batch_expiry'
  | 'serial'
  | 'recipe';

export interface ActivityDefinition {
  code: string;
  section: string;
  name_en: string;
  workflow: ActivityWorkflow;
  stock_mode: ActivityStockMode;
  capabilities: string[];
  payment_modes: string[];
  pricing_dimensions: unknown[];
  customer_fields: unknown[];
}

type Row = [
  code: string,
  section: string,
  name_en: string,
  workflow: ActivityWorkflow,
  stock_mode: ActivityStockMode,
  capabilities: string,
];

const ROWS: Row[] = [
  ['restaurant', 'restaurants', 'Restaurant', 'table_kitchen', 'recipe', 'pos.menu,tables,kitchen'],
  ['cafe', 'restaurants', 'Cafe', 'table_kitchen', 'recipe', 'pos.menu,tables,kitchen'],
  ['fastFood', 'restaurants', 'Fast food', 'instant', 'recipe', 'pos.menu,kitchen'],
  ['bakery', 'restaurants', 'Bakery', 'instant', 'recipe', 'pos.grid,batches'],
  ['juice', 'restaurants', 'Juice bar', 'instant', 'recipe', 'pos.menu'],
  ['foodTruck', 'restaurants', 'Food truck', 'instant', 'recipe', 'pos.menu'],
  ['grocery', 'retail', 'Grocery', 'instant', 'batch_expiry', 'pos.grid,barcode,batches'],
  ['supermarket', 'retail', 'Supermarket', 'instant', 'batch_expiry', 'pos.grid,barcode,batches,scales'],
  ['perfume', 'retail', 'Perfume', 'instant', 'qty', 'pos.grid,barcode'],
  ['stationery', 'retail', 'Stationery', 'instant', 'qty', 'pos.grid,barcode'],
  ['gifts', 'retail', 'Gifts', 'instant', 'qty', 'pos.grid,barcode'],
  ['menClothing', 'fashion', 'Men clothing', 'instant', 'qty', 'pos.grid,barcode,variants'],
  ['womenClothing', 'fashion', 'Women clothing', 'instant', 'qty', 'pos.grid,barcode,variants'],
  ['shoes', 'fashion', 'Shoes', 'instant', 'qty', 'pos.grid,barcode,variants'],
  ['accessories', 'fashion', 'Accessories', 'instant', 'qty', 'pos.grid,barcode'],
  ['tailoring', 'fashion', 'Tailoring', 'work_order', 'none', 'pos.services,work_orders,appointments'],
  ['pharmacy', 'health', 'Pharmacy', 'instant', 'batch_expiry', 'pos.grid,barcode,batches'],
  ['medical', 'health', 'Medical supplies', 'instant', 'batch_expiry', 'pos.grid,barcode,batches'],
  ['clinic', 'health', 'Clinic', 'appointment', 'none', 'pos.services,appointments'],
  ['optics', 'health', 'Optics', 'work_order', 'qty', 'pos.grid,work_orders'],
  ['supplements', 'health', 'Supplements', 'instant', 'batch_expiry', 'pos.grid,barcode,batches'],
  ['barber', 'beauty', 'Barber', 'appointment', 'none', 'pos.services,appointments,staff_commission'],
  ['womenSalon', 'beauty', 'Women salon', 'appointment', 'none', 'pos.services,appointments,staff_commission'],
  ['spa', 'beauty', 'Spa', 'appointment', 'none', 'pos.services,appointments,packages'],
  ['cosmetics', 'beauty', 'Cosmetics', 'instant', 'qty', 'pos.grid,barcode'],
  ['carWash', 'services', 'Car wash', 'queue', 'none', 'pos.services,queue,vehicles,staff_commission'],
  ['laundry', 'services', 'Laundry', 'work_order', 'none', 'pos.services,work_orders,delivery'],
  ['phoneFix', 'services', 'Phone repair', 'work_order', 'serial', 'pos.services,work_orders,serials,warranty'],
  ['carWorkshop', 'services', 'Car workshop', 'work_order', 'qty', 'pos.services,work_orders,vehicles,warranty'],
  ['homeServices', 'services', 'Home services', 'work_order', 'none', 'pos.services,work_orders,appointments,delivery'],
  ['tireOil', 'services', 'Tire & oil change', 'queue', 'qty', 'pos.services,queue,vehicles,warranty'],
  ['phones', 'electronics', 'Phones', 'instant', 'serial', 'pos.grid,barcode,serials,warranty'],
  ['gadgets', 'electronics', 'Gadgets', 'instant', 'serial', 'pos.grid,barcode,serials,warranty'],
  ['gaming', 'electronics', 'Gaming', 'instant', 'serial', 'pos.grid,barcode,serials,warranty'],
  ['furniture', 'home', 'Furniture', 'instant', 'qty', 'pos.grid,delivery,deposits'],
  ['homeware', 'home', 'Homeware', 'instant', 'qty', 'pos.grid,barcode'],
  ['flowers', 'home', 'Flowers', 'instant', 'batch_expiry', 'pos.grid,delivery,deposits'],
  ['pets', 'home', 'Pets', 'instant', 'qty', 'pos.grid,barcode'],
];

export const ACTIVITY_CATALOG: ActivityDefinition[] = ROWS.map(
  ([code, section, name_en, workflow, stock_mode, caps]) => ({
    code,
    section,
    name_en,
    workflow,
    stock_mode,
    capabilities: caps.split(','),
    payment_modes: ['standard'],
    pricing_dimensions: [],
    customer_fields: [],
  }),
);

export const ACTIVITY_BY_CODE = new Map(
  ACTIVITY_CATALOG.map((a) => [a.code, a] as const),
);
