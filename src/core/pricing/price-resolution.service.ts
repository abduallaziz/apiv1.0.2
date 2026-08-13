import { Injectable, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';
import { PermissionsService } from '../permissions/permissions.service';
import {
  EffectiveRoleResolver,
  EffectiveRole,
} from './effective-role.resolver';

// D01-M6 — the first Official Price Resolution layer this project has ever
// had (InvoicesService.create() takes unit_price straight from the client
// today — confirmed, not assumed). Pure read-then-compute: no Order, no
// Order Item, no Audit row, no transaction, no DB write of any kind.
//
// Reuses D01-M5's EffectiveRoleResolver and the existing PermissionsService
// as-is — no role-resolution or permission logic is duplicated here.

export interface PriceResolutionInput {
  userId: string;
  tenantId: string;
  branchId: string;
  itemId: string;
  variantId?: string;
  requestedUnitPrice: number;
  reason?: string;
  hasInvoiceLevelDiscount: boolean;
  // D01-M7 — Effective Role is identical for every line of the same
  // invoice (same userId). Omit (undefined) to have this call resolve it
  // itself; pass the result of an earlier call in the same invoice
  // (including `null`, meaning "resolved to no role") to skip a redundant
  // DB round trip. Never consulted at all for a Normal Sale line (no_override
  // short-circuits before this matters), so passing it costs nothing there.
  effectiveRole?: EffectiveRole | null;
}

export type PriceResolutionResult =
  | { kind: 'no_override'; officialUnitPrice: number }
  | {
      kind: 'approved';
      officialUnitPrice: number;
      approvedUnitPrice: number;
      differenceAmount: number;
      differencePercent: number;
      direction: 'discount' | 'increase';
      reason: string | null;
      effectiveRole: EffectiveRole;
      effectivePolicySnapshot: EffectivePolicy;
    }
  | {
      kind: 'rejected';
      officialUnitPrice: number;
      requestedUnitPrice: number;
      reasonCode: RejectionReasonCode;
      // Populated only when this call actually consulted an Effective Role
      // (own resolution or the caller-supplied one) before rejecting — lets
      // an invoice-level caller cache it for the next line even on a
      // rejection. Absent (not just null) when rejection happened before
      // role resolution was ever reached (not-found / official=0 cases).
      resolvedEffectiveRole?: EffectiveRole | null;
    };

export type RejectionReasonCode =
  | 'item_or_variant_not_found'
  | 'official_price_zero_increase_not_supported'
  | 'no_effective_role'
  | 'no_effective_policy'
  | 'permission_denied'
  | 'discount_not_allowed'
  | 'increase_not_allowed'
  | 'limit_exceeded'
  | 'reason_required'
  | 'zero_price_not_allowed'
  | 'combine_with_discount_not_allowed';

interface EffectivePolicy {
  allow_discount: boolean | null;
  allow_increase: boolean | null;
  allow_combine_with_discount: boolean | null;
  max_discount_percent: number | null;
  max_increase_percent: number | null;
  reason_policy:
    | 'not_required'
    | 'always_required'
    | 'required_above_threshold'
    | 'optional'
    | null;
  reason_threshold_percent: number | null;
  allow_zero_price: boolean | null;
  zero_price_requires_permission: boolean | null;
  zero_price_requires_reason: boolean | null;
}

interface PolicyRow {
  branch_id: string | null;
  role_id: string | null;
  allow_discount: boolean | null;
  allow_increase: boolean | null;
  allow_combine_with_discount: boolean | null;
  max_discount_percent: number | null;
  max_increase_percent: number | null;
  reason_policy: EffectivePolicy['reason_policy'];
  reason_threshold_percent: number | null;
  allow_zero_price: boolean | null;
  zero_price_requires_permission: boolean | null;
  zero_price_requires_reason: boolean | null;
}

const NOT_FOUND = Symbol('item-or-variant-not-found');

@Injectable()
export class PriceResolutionService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
    private readonly permissionsService: PermissionsService,
    private readonly effectiveRoleResolver: EffectiveRoleResolver,
  ) {}

  async resolvePrice(
    input: PriceResolutionInput,
  ): Promise<PriceResolutionResult> {
    const official = await this.resolveOfficialPrice(
      input.itemId,
      input.variantId,
      input.tenantId,
    );

    if (official === NOT_FOUND) {
      return {
        kind: 'rejected',
        officialUnitPrice: 0,
        requestedUnitPrice: input.requestedUnitPrice,
        reasonCode: 'item_or_variant_not_found',
      };
    }

    // Case: official=0, requested>0 — short-circuit before Role/Permission/
    // Policy/reason/percentage work. differencePercent is mathematically
    // undefined here (division by zero); Owner Decision was to reject
    // outright rather than invent a fallback percent.
    if (official === 0 && input.requestedUnitPrice > 0) {
      return {
        kind: 'rejected',
        officialUnitPrice: 0,
        requestedUnitPrice: input.requestedUnitPrice,
        reasonCode: 'official_price_zero_increase_not_supported',
      };
    }

    // Covers official=0/requested=0 too (equality, handled below uniformly).
    if (input.requestedUnitPrice === official) {
      return { kind: 'no_override', officialUnitPrice: official };
    }

    // official > 0 guaranteed past this point (the only other way to reach
    // here is official>0 with requested != official).
    const direction: 'discount' | 'increase' =
      input.requestedUnitPrice < official ? 'discount' : 'increase';
    const differenceAmount = Math.abs(input.requestedUnitPrice - official);
    const differencePercent = (differenceAmount / official) * 100;

    const effectiveRole =
      input.effectiveRole !== undefined
        ? input.effectiveRole
        : await this.effectiveRoleResolver.resolveEffectiveRole(input.userId);
    if (!effectiveRole) {
      return {
        kind: 'rejected',
        officialUnitPrice: official,
        requestedUnitPrice: input.requestedUnitPrice,
        reasonCode: 'no_effective_role',
        resolvedEffectiveRole: null,
      };
    }

    const hasPermission = await this.permissionsService.hasPermissionForUser(
      input.userId,
      'invoice.price_override',
      input.tenantId,
    );
    if (!hasPermission) {
      return {
        kind: 'rejected',
        officialUnitPrice: official,
        requestedUnitPrice: input.requestedUnitPrice,
        reasonCode: 'permission_denied',
        resolvedEffectiveRole: effectiveRole,
      };
    }

    const policy = await this.resolveEffectivePolicy(
      input.tenantId,
      input.branchId,
      effectiveRole.roleId,
    );
    if (!policy) {
      return {
        kind: 'rejected',
        officialUnitPrice: official,
        requestedUnitPrice: input.requestedUnitPrice,
        reasonCode: 'no_effective_policy',
        resolvedEffectiveRole: effectiveRole,
      };
    }

    const isZeroPrice = input.requestedUnitPrice === 0;

    if (isZeroPrice) {
      if (policy.allow_zero_price !== true) {
        return this.rejected(
          official,
          input.requestedUnitPrice,
          'zero_price_not_allowed',
          effectiveRole,
        );
      }
    }

    if (direction === 'discount') {
      if (policy.allow_discount !== true) {
        return this.rejected(
          official,
          input.requestedUnitPrice,
          'discount_not_allowed',
          effectiveRole,
        );
      }
      if (
        policy.max_discount_percent === null ||
        differencePercent > policy.max_discount_percent
      ) {
        return this.rejected(
          official,
          input.requestedUnitPrice,
          'limit_exceeded',
          effectiveRole,
        );
      }
    } else {
      if (policy.allow_increase !== true) {
        return this.rejected(
          official,
          input.requestedUnitPrice,
          'increase_not_allowed',
          effectiveRole,
        );
      }
      if (
        policy.max_increase_percent === null ||
        differencePercent > policy.max_increase_percent
      ) {
        return this.rejected(
          official,
          input.requestedUnitPrice,
          'limit_exceeded',
          effectiveRole,
        );
      }
    }

    const trimmedReason = input.reason?.trim() ?? '';
    const reasonRequired =
      policy.reason_policy === 'always_required' ||
      (isZeroPrice && policy.zero_price_requires_reason === true) ||
      (policy.reason_policy === 'required_above_threshold' &&
        policy.reason_threshold_percent !== null &&
        differencePercent > policy.reason_threshold_percent);

    if (reasonRequired && trimmedReason.length === 0) {
      return this.rejected(
        official,
        input.requestedUnitPrice,
        'reason_required',
        effectiveRole,
      );
    }

    if (
      input.hasInvoiceLevelDiscount &&
      policy.allow_combine_with_discount !== true
    ) {
      return this.rejected(
        official,
        input.requestedUnitPrice,
        'combine_with_discount_not_allowed',
        effectiveRole,
      );
    }

    return {
      kind: 'approved',
      officialUnitPrice: official,
      approvedUnitPrice: input.requestedUnitPrice,
      differenceAmount,
      differencePercent,
      direction,
      reason: trimmedReason.length > 0 ? trimmedReason : null,
      effectiveRole,
      effectivePolicySnapshot: policy,
    };
  }

  private rejected(
    officialUnitPrice: number,
    requestedUnitPrice: number,
    reasonCode: RejectionReasonCode,
    resolvedEffectiveRole: EffectiveRole,
  ): PriceResolutionResult {
    return {
      kind: 'rejected',
      officialUnitPrice,
      requestedUnitPrice,
      reasonCode,
      resolvedEffectiveRole,
    };
  }

  private async resolveOfficialPrice(
    itemId: string,
    variantId: string | undefined,
    tenantId: string,
  ): Promise<number | typeof NOT_FOUND> {
    const { data: item, error: itemError } = await this.supabase
      .from('items')
      .select('price, is_active, deleted_at')
      .eq('id', itemId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (
      itemError ||
      !item ||
      item.deleted_at !== null ||
      item.is_active !== true
    ) {
      return NOT_FOUND;
    }

    if (!variantId) {
      return Number(item.price);
    }

    const { data: variant, error: variantError } = await this.supabase
      .from('item_variants')
      .select('price_adjustment, is_active, item_id')
      .eq('id', variantId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (
      variantError ||
      !variant ||
      variant.is_active !== true ||
      variant.item_id !== itemId
    ) {
      return NOT_FOUND;
    }

    return Number(item.price) + Number(variant.price_adjustment);
  }

  private async resolveEffectivePolicy(
    tenantId: string,
    branchId: string,
    roleId: string,
  ): Promise<EffectivePolicy | null> {
    const { data, error } = await this.supabase
      .from('price_override_policies')
      .select(
        'branch_id, role_id, allow_discount, allow_increase, allow_combine_with_discount, ' +
          'max_discount_percent, max_increase_percent, reason_policy, reason_threshold_percent, ' +
          'allow_zero_price, zero_price_requires_permission, zero_price_requires_reason',
      )
      .eq('tenant_id', tenantId);

    if (error || !data) return null;

    const rows = data as unknown as PolicyRow[];
    const tenantRow =
      rows.find((r) => r.branch_id === null && r.role_id === null) ?? null;
    if (!tenantRow) return null; // No Tenant Default Policy at all — Denied (§14).

    const branchRow =
      rows.find((r) => r.branch_id === branchId && r.role_id === null) ?? null;
    const roleRow =
      rows.find((r) => r.branch_id === branchId && r.role_id === roleId) ??
      null;

    const pick = <K extends keyof PolicyRow>(key: K): PolicyRow[K] =>
      roleRow?.[key] ?? branchRow?.[key] ?? tenantRow[key] ?? null;

    return {
      allow_discount: pick('allow_discount'),
      allow_increase: pick('allow_increase'),
      allow_combine_with_discount: pick('allow_combine_with_discount'),
      max_discount_percent: pick('max_discount_percent'),
      max_increase_percent: pick('max_increase_percent'),
      reason_policy: pick('reason_policy'),
      reason_threshold_percent: pick('reason_threshold_percent'),
      allow_zero_price: pick('allow_zero_price'),
      zero_price_requires_permission: pick('zero_price_requires_permission'),
      zero_price_requires_reason: pick('zero_price_requires_reason'),
    };
  }
}
