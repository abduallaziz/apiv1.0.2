import { RedisCacheService } from '../../../../core/cache/redis-cache.service';
import { BranchPublishRegistry } from '../branch-publish.registry';
import { EntityPublisher } from '../branch-publish.types';
import { itemsPublisher } from './items.publisher';
import { simplePublisher } from './simple.publisher';

/** document_templates are tenant-wide and assigned to branches through assignments: nothing to clone per branch. */
const documentTemplates: EntityPublisher = {
  type: 'document_templates',
  group: 'documents',
  labelAr: 'قوالب المستندات',
  labelEn: 'Document templates',
  supported: false,
  unsupportedReason:
    'Templates are tenant-wide and are assigned to branches from the template builder (not branch-owned).',
  loadSources: () => Promise.reject(new Error('not supported')),
  listSourceIds: () => Promise.resolve([]),
  findExisting: () => Promise.resolve(null),
  exists: () => Promise.resolve(false),
  create: () => Promise.reject(new Error('not supported')),
  update: () => Promise.reject(new Error('not supported')),
};

/** Registers every built-in publishable type. To add one, see docs/DESIGN_BRANCH_ISOLATION.md section 7. */
export function registerBuiltInPublishers(
  registry: BranchPublishRegistry,
  cache?: RedisCacheService,
): BranchPublishRegistry {
  return registry
    .register(itemsPublisher(cache))
    .register(
      simplePublisher({
        type: 'categories',
        group: 'setup',
        labelAr: 'التصنيفات',
        labelEn: 'Categories',
        table: 'categories',
        columns: ['name', 'type', 'is_active'],
        naturalKey: { column: 'name', caseInsensitive: true },
        hasUpdatedAt: false,
      }),
    )
    .register(
      simplePublisher({
        type: 'brands',
        group: 'setup',
        labelAr: 'العلامات التجارية',
        labelEn: 'Brands',
        table: 'brands',
        columns: ['name', 'is_active'],
        naturalKey: { column: 'name', caseInsensitive: true },
        hasUpdatedAt: false,
      }),
    )
    .register(
      simplePublisher({
        type: 'units',
        group: 'setup',
        labelAr: 'وحدات القياس',
        labelEn: 'Units',
        table: 'units',
        columns: ['name', 'symbol', 'is_active'],
        naturalKey: { column: 'name', caseInsensitive: true },
        hasUpdatedAt: false,
      }),
    )
    .register(
      simplePublisher({
        type: 'shift_patterns',
        group: 'setup',
        labelAr: 'أنماط الورديات',
        labelEn: 'Shift patterns',
        table: 'shift_patterns',
        columns: ['name', 'days_of_week', 'day_overrides', 'shifts'],
        naturalKey: { column: 'name', caseInsensitive: true },
        softDelete: false,
      }),
    )
    .register(
      simplePublisher({
        type: 'coupons',
        group: 'promotions',
        labelAr: 'الكوبونات',
        labelEn: 'Coupons',
        table: 'coupons',
        columns: [
          'code',
          'discount_type',
          'discount_value',
          'max_discount_amount',
          'min_order_amount',
          'max_uses',
          'valid_from',
          'valid_to',
          'is_active',
        ],
        naturalKey: { column: 'code', caseInsensitive: true },
        // used_count is per branch: a published coupon starts unused (default 0).
      }),
    )
    .register(
      simplePublisher({
        type: 'reward_definitions',
        group: 'promotions',
        labelAr: 'تعريفات المكافآت',
        labelEn: 'Reward definitions',
        table: 'reward_definitions',
        columns: [
          'name',
          'trigger_type',
          'trigger_config',
          'reward_type',
          'reward_config',
          'usage_conditions',
          'expiration_days',
          'is_active',
        ],
        naturalKey: { column: 'name', caseInsensitive: true },
        // Under isolation a definition belongs to exactly one branch (chk: 'specific' needs branch_id).
        overrides: () => ({ branch_scope: 'specific' }),
      }),
    )
    .register(
      simplePublisher({
        type: 'loyalty_tiers',
        group: 'setup',
        labelAr: 'مستويات الولاء',
        labelEn: 'Loyalty tiers',
        table: 'loyalty_tiers',
        columns: [
          'name',
          'min_lifetime_points',
          'points_multiplier',
          'sort_order',
        ],
        naturalKey: { column: 'name', caseInsensitive: true },
      }),
    )
    .register(
      simplePublisher({
        type: 'note_presets',
        group: 'promotions',
        labelAr: 'ملاحظات جاهزة',
        labelEn: 'Note presets',
        table: 'note_presets',
        columns: ['text', 'sort_order', 'is_active'],
        naturalKey: { column: 'text', caseInsensitive: true },
      }),
    )
    .register(
      simplePublisher({
        type: 'customer_field_definitions',
        group: 'setup',
        labelAr: 'حقول العملاء المخصصة',
        labelEn: 'Customer custom fields',
        table: 'customer_field_definitions',
        columns: [
          'field_key',
          'label_ar',
          'label_en',
          'field_type',
          'options',
          'required',
          'is_active',
          'sort_order',
          'contact_role',
        ],
        naturalKey: { column: 'field_key' },
      }),
    )
    .register(
      simplePublisher({
        type: 'expense_categories_v2',
        group: 'setup',
        labelAr: 'تصنيفات المصروفات',
        labelEn: 'Expense categories',
        table: 'expense_categories_v2',
        columns: ['name', 'code', 'description', 'is_active'],
        naturalKey: { column: 'name' },
        softDelete: false,
      }),
    )
    .register(
      simplePublisher({
        type: 'expense_departments',
        group: 'setup',
        labelAr: 'أقسام المصروفات',
        labelEn: 'Expense departments',
        table: 'expense_departments',
        columns: ['name', 'code', 'description', 'is_active'],
        naturalKey: { column: 'name' },
        softDelete: false,
      }),
    )
    .register(documentTemplates);
}
