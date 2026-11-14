import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';
import { TenantContext } from '../../core/tenant/tenant.context';

/**
 * Branch rules shared by the HR services (docs/DESIGN_BRANCH_ISOLATION.md D7): an employee belongs to
 * exactly one branch, and attendance / schedules / geofences / exceptions follow the employee's branch.
 * Everything here is a no-op while the tenant runs with isolation off.
 */
@Injectable()
export class HrBranchService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  /**
   * Under isolation returns the branch an employee's HR rows are stamped with, and 404s when the
   * employee is not visible from the working branch. With isolation off returns `fallback`.
   */
  async branchOfEmployee(
    tenant: TenantContext,
    userId: string,
    fallback: string | null = null,
  ): Promise<string | null> {
    if (!tenant.isolated) return fallback;
    const { data, error } = await this.supabase
      .from('users')
      .select('branch_id')
      .eq('id', userId)
      .eq('tenant_id', tenant.tenantId)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw error;
    const branch = (data as { branch_id: string | null } | null)?.branch_id;
    if (!data || branch !== tenant.branchId) {
      throw new NotFoundException(`User not found: ${userId}`);
    }
    return branch;
  }

  /** Same visibility rule for a list of employees (bulk operations). */
  async assertEmployeesInScope(tenant: TenantContext, userIds: string[]) {
    if (!tenant.isolated) return;
    for (const id of userIds) await this.branchOfEmployee(tenant, id);
  }
}
