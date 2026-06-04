import { Injectable, ForbiddenException, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';

@Injectable()
export class BranchValidatorService {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: SupabaseClient,
  ) {}

  async validate(branchId: string, tenantId: string): Promise<void> {
    const { data, error } = await this.supabase
      .from('branches')
      .select('id, tenant_id, is_active')
      .eq('id', branchId)
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .maybeSingle();

    if (error || !data) {
      throw new ForbiddenException('Branch not found or does not belong to tenant');
    }
  }
}