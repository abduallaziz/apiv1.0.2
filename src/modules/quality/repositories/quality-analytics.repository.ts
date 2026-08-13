import { Injectable } from '@nestjs/common';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';

// Reuses the Advanced Analytics pattern (#18): thin repository reading
// existing tables/views, no new ledger, no duplicated computation — pass/
// fail rate and NCR/CAPA counts are simple aggregations over data that
// already exists (quality_inspections, non_conformances, corrective_actions,
// v_supplier_quality_scores, v_quality_cost_summary).
@Injectable()
export class QualityAnalyticsRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async inspectionSummary(tenantId: string) {
    const { data, error } = await this.supabase
      .from('quality_inspections')
      .select('status')
      .eq('tenant_id', tenantId);
    if (error) throw error;
    const total = data.length;
    const passed = data.filter((r: any) => r.status === 'passed').length;
    const failed = data.filter((r: any) => r.status === 'failed').length;
    const conditional = data.filter(
      (r: any) => r.status === 'conditional',
    ).length;
    const pending = data.filter((r: any) => r.status === 'pending').length;
    return {
      total_inspections: total,
      pending,
      pass_rate_percentage:
        total > 0 ? Math.round((passed / total) * 10000) / 100 : null,
      failure_rate_percentage:
        total > 0 ? Math.round((failed / total) * 10000) / 100 : null,
      conditional_count: conditional,
    };
  }

  async ncrTrends(tenantId: string) {
    const { data, error } = await this.supabase
      .from('non_conformances')
      .select('status, severity, created_at')
      .eq('tenant_id', tenantId);
    if (error) throw error;
    const byStatus: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    for (const row of data as any[]) {
      byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
      bySeverity[row.severity] = (bySeverity[row.severity] ?? 0) + 1;
    }
    return { total: data.length, by_status: byStatus, by_severity: bySeverity };
  }

  async capaPerformance(tenantId: string) {
    const { data, error } = await this.supabase
      .from('corrective_actions')
      .select('status, due_date, completed_at')
      .eq('tenant_id', tenantId);
    if (error) throw error;
    const total = data.length;
    const closed = data.filter((r: any) => r.status === 'closed').length;
    const overdue = data.filter(
      (r: any) =>
        r.due_date && !r.completed_at && new Date(r.due_date) < new Date(),
    ).length;
    return {
      total_actions: total,
      closed_count: closed,
      completion_rate_percentage:
        total > 0 ? Math.round((closed / total) * 10000) / 100 : null,
      overdue_count: overdue,
    };
  }

  async supplierQualityRanking(tenantId: string) {
    const { data, error } = await this.supabase
      .from('v_supplier_quality_scores')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('pass_rate_percentage', { ascending: true });
    if (error) throw error;
    return data;
  }

  async qualityCostSummary(tenantId: string) {
    const { data, error } = await this.supabase
      .from('v_quality_cost_summary')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('month', { ascending: false });
    if (error) throw error;
    return data;
  }
}
