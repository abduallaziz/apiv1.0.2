import { Injectable, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';

// D01-M5 — Effective Role resolution for the Pricing Override domain only.
// Deliberately isolated from PermissionsService: this answers "which single
// Role represents this user for D01 Policy Resolution", not "what is this
// user allowed to do". Reads user_roles/roles directly — never
// users.role, JWT roles, or user_permissions_override (those answer a
// different question and must stay untouched by this resolver).
//
// superadmin is platform-level and structurally excluded from D01 (see
// migration 190's fn_guard_price_override_policies_role, which rejects it
// for the same reason). PROTECTED_ROLE_NAMES in access-control.service.ts
// is NOT reused here — it also includes 'owner', which IS D01-eligible.
const D01_EXCLUDED_ROLE_NAMES = new Set(['superadmin']);

export interface EffectiveRole {
  roleId: string;
  roleName: string;
  priority: number;
}

interface UserRoleRow {
  is_primary: boolean;
  role: {
    id: string;
    name: string;
    priority: number;
    is_hierarchy_participant: boolean;
  } | null;
}

@Injectable()
export class EffectiveRoleResolver {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  // Owner Decision (D01-M5 Final Tie Resolution): on an unresolved tie —
  // top priority shared by more than one eligible role, with zero or more
  // than one of them is_primary — the result is null, not an arbitrary
  // pick. No alphabetical/created_at/UUID/row-order/LIMIT-1 fallback.
  async resolveEffectiveRole(userId: string): Promise<EffectiveRole | null> {
    const { data, error } = await this.supabase
      .from('user_roles')
      .select(
        'is_primary, role:roles!user_roles_role_id_fkey(id, name, priority, is_hierarchy_participant)',
      )
      .eq('user_id', userId);

    if (error || !data) return null;

    const eligible = (data as unknown as UserRoleRow[])
      .filter((row) => row.role !== null)
      .filter(
        (row) =>
          row.role.is_hierarchy_participant &&
          !D01_EXCLUDED_ROLE_NAMES.has(row.role.name),
      );

    if (eligible.length === 0) return null;

    const maxPriority = Math.max(...eligible.map((row) => row.role.priority));
    const candidates = eligible.filter(
      (row) => row.role.priority === maxPriority,
    );

    if (candidates.length === 1) {
      return toEffectiveRole(candidates[0]);
    }

    const primaryCandidates = candidates.filter(
      (row) => row.is_primary === true,
    );
    if (primaryCandidates.length === 1) {
      return toEffectiveRole(primaryCandidates[0]);
    }

    // primaryCandidates.length === 0 or > 1 — unresolved tie, fail closed.
    return null;
  }
}

function toEffectiveRole(row: UserRoleRow): EffectiveRole {
  return {
    roleId: row.role.id,
    roleName: row.role.name,
    priority: row.role.priority,
  };
}
