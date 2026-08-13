import { Injectable } from '@nestjs/common';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';

// Templates, template checks, plans, and rules together — all small,
// closely-related configuration entities (Phase 1's "Quality Foundation" +
// "Quality Rule Engine"), kept in one repository to avoid three near-empty
// files for what is fundamentally one configuration surface.
@Injectable()
export class QualityConfigRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  // Templates
  async findAllTemplates(tenantId: string) {
    const { data, error } = await this.supabase
      .from('quality_templates')
      .select('*, quality_template_checks(*)')
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }

  async findTemplateById(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('quality_templates')
      .select('*, quality_template_checks(*)')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async createTemplate(tenantId: string, name: string, notes: string | null, checks: Record<string, unknown>[]) {
    const { data: template, error } = await this.supabase
      .from('quality_templates')
      .insert({ tenant_id: tenantId, name, notes })
      .select()
      .single();
    if (error) throw error;

    const { error: checksError } = await this.supabase.from('quality_template_checks').insert(
      checks.map((c, idx) => ({ ...c, tenant_id: tenantId, template_id: template.id, sequence: c.sequence ?? idx + 1 })),
    );
    if (checksError) throw checksError;

    return this.findTemplateById(template.id, tenantId);
  }

  async updateTemplate(id: string, tenantId: string, payload: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('quality_templates')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  // Plans
  async findAllPlans(tenantId: string) {
    const { data, error } = await this.supabase
      .from('quality_plans')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }

  async createPlan(tenantId: string, payload: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('quality_plans')
      .insert({ ...payload, tenant_id: tenantId })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  // Rules
  async findAllRules(tenantId: string) {
    const { data, error } = await this.supabase
      .from('quality_rules')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }

  async createRule(tenantId: string, payload: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('quality_rules')
      .insert({ ...payload, tenant_id: tenantId })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  // Resolves the applicable rule/plan for a transaction — called by
  // Purchasing/Manufacturing/Inventory integration points.
  async resolvePlan(
    tenantId: string,
    transactionType: string,
    itemId: string,
    categoryId: string | null,
    supplierId: string | null,
    warehouseId: string | null,
  ) {
    const { data, error } = await this.supabase.rpc('fn_resolve_quality_plan', {
      p_tenant_id: tenantId,
      p_transaction_type: transactionType,
      p_item_id: itemId,
      p_category_id: categoryId,
      p_supplier_id: supplierId,
      p_warehouse_id: warehouseId,
    });
    if (error) throw error;
    return data?.[0] ?? null;
  }
}
