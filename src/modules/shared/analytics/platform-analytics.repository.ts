import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../../shared/supabase/supabase.module';
import { AnalyticsPeriod } from './dto/analytics-query.dto';

interface PlanEntry {
  name: string;
  price: number;
  count: number;
}

@Injectable()
export class PlatformAnalyticsRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async getGlobalStats() {
    const [tenants, users, orders, revenue] = await Promise.all([
      this.supabase.from('tenants').select('*', { count: 'exact', head: true }).is('deleted_at', null),
      this.supabase.from('users').select('*', { count: 'exact', head: true }).is('deleted_at', null),
      this.supabase.from('orders').select('*', { count: 'exact', head: true }),
      this.supabase.from('orders').select('total').eq('status', 'completed'),
    ]);
    const totalRevenue = (revenue.data ?? []).reduce(
      (sum: number, row: any) => sum + Number(row.total ?? 0), 0,
    );
    return {
      totalTenants: tenants.count ?? 0,
      totalUsers: users.count ?? 0,
      totalOrders: orders.count ?? 0,
      totalRevenue,
    };
  }

  async getRevenueReport(params: {
    from: string;
    to: string;
    tenantId?: string;
    groupBy?: 'day' | 'month';
  }) {
    let query = this.supabase
      .from('orders')
      .select('created_at, total')
      .eq('status', 'completed')
      .gte('created_at', params.from)
      .lte('created_at', params.to);
    if (params.tenantId) {
      query = query.eq('tenant_id', params.tenantId);
    }
    const { data } = await query;
    return data ?? [];
  }

  private getDateRange(period: AnalyticsPeriod): { from: Date; to: Date } {
    const to = new Date();
    const from = new Date();
    switch (period) {
      case AnalyticsPeriod.LAST_30_DAYS: from.setDate(from.getDate() - 30); break;
      case AnalyticsPeriod.LAST_90_DAYS: from.setDate(from.getDate() - 90); break;
      case AnalyticsPeriod.LAST_6_MONTHS: from.setMonth(from.getMonth() - 6); break;
      case AnalyticsPeriod.LAST_12_MONTHS: from.setMonth(from.getMonth() - 12); break;
      case AnalyticsPeriod.YEAR_TO_DATE: from.setMonth(0, 1); from.setHours(0, 0, 0, 0); break;
    }
    return { from, to };
  }

  private buildRange(period: AnalyticsPeriod, customFrom?: string, customTo?: string): { from: Date; to: Date } {
    return customFrom && customTo
      ? { from: new Date(customFrom), to: new Date(customTo) }
      : this.getDateRange(period);
  }

  async getMRR(): Promise<number> {
    const { data } = await this.supabase
      .from('subscriptions')
      .select('plan_id, plans!inner(price_monthly)')
      .eq('status', 'active');
    if (!data) return 0;
    return (data as any[]).reduce((sum: number, row: any) => sum + (row.plans?.price_monthly ?? 0), 0);
  }

  async getARR(): Promise<number> {
    return (await this.getMRR()) * 12;
  }

  async getMRRHistory(period: AnalyticsPeriod, customFrom?: string, customTo?: string): Promise<{ month: string; mrr: number }[]> {
    const range = this.buildRange(period, customFrom, customTo);
    const { data } = await this.supabase
      .from('subscriptions')
      .select('started_at, ends_at, cancelled_at, status, plan_id, plans!inner(price_monthly)')
      .in('status', ['active', 'cancelled', 'expired'])
      .gte('started_at', range.from.toISOString());
    if (!data) return [];
    const months = new Map<string, number>();
    const cursor = new Date(range.from);
    cursor.setDate(1);
    while (cursor <= range.to) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
      months.set(key, 0);
      cursor.setMonth(cursor.getMonth() + 1);
    }
    for (const row of data as any[]) {
      const subStart = new Date(row.started_at);
      const subEnd = row.cancelled_at ? new Date(row.cancelled_at) : row.ends_at ? new Date(row.ends_at) : new Date();
      const price: number = row.plans?.price_monthly ?? 0;
      for (const [key] of months) {
        const [yr, mo] = key.split('-').map(Number);
        const mStart = new Date(yr, mo - 1, 1);
        const mEnd = new Date(yr, mo, 0);
        if (subStart <= mEnd && subEnd >= mStart) {
          months.set(key, (months.get(key) ?? 0) + price);
        }
      }
    }
    return Array.from(months.entries()).map(([month, mrr]) => ({ month, mrr }));
  }

  async getChurnRate(period: AnalyticsPeriod, customFrom?: string, customTo?: string): Promise<{
    churnRate: number;
    churned: number;
    startingCount: number;
    monthly: { month: string; churned: number; rate: number }[];
  }> {
    const range = this.buildRange(period, customFrom, customTo);
    const [{ data: churned }, { count: startingCount }] = await Promise.all([
      this.supabase.from('subscriptions').select('cancelled_at, tenant_id')
        .in('status', ['cancelled', 'expired'])
        .gte('cancelled_at', range.from.toISOString())
        .lte('cancelled_at', range.to.toISOString()),
      this.supabase.from('subscriptions').select('*', { count: 'exact', head: true })
        .eq('status', 'active').lte('started_at', range.from.toISOString()),
    ]);
    const churnedCount = churned?.length ?? 0;
    const start = startingCount ?? 1;
    const churnRate = Math.round((churnedCount / start) * 10000) / 100;
    const monthlyMap = new Map<string, number>();
    for (const row of churned ?? []) {
      const d = new Date(row.cancelled_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthlyMap.set(key, (monthlyMap.get(key) ?? 0) + 1);
    }
    const monthly = Array.from(monthlyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, c]) => ({ month, churned: c, rate: Math.round((c / start) * 10000) / 100 }));
    return { churnRate, churned: churnedCount, startingCount: start, monthly };
  }

  async getGrowthRate(period: AnalyticsPeriod, customFrom?: string, customTo?: string): Promise<{
    growthRate: number;
    newTenants: number;
    monthly: { month: string; new: number; cumulative: number }[];
  }> {
    const range = this.buildRange(period, customFrom, customTo);
    const [{ data }, { count: baseline }] = await Promise.all([
      this.supabase.from('tenants').select('created_at').is('deleted_at', null)
        .gte('created_at', range.from.toISOString())
        .lte('created_at', range.to.toISOString())
        .order('created_at', { ascending: true }),
      this.supabase.from('tenants').select('*', { count: 'exact', head: true })
        .is('deleted_at', null).lt('created_at', range.from.toISOString()),
    ]);
    if (!data || data.length === 0) return { growthRate: 0, newTenants: 0, monthly: [] };
    const monthlyMap = new Map<string, number>();
    for (const row of data) {
      const d = new Date(row.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthlyMap.set(key, (monthlyMap.get(key) ?? 0) + 1);
    }
    let cumulative = baseline ?? 0;
    const startVal = cumulative;
    const monthly = Array.from(monthlyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, newCount]) => { cumulative += newCount; return { month, new: newCount, cumulative }; });
    const growthRate = startVal === 0 ? 100 : Math.round(((cumulative - startVal) / startVal) * 10000) / 100;
    return { growthRate, newTenants: data.length, monthly };
  }

  async getConversionFunnel(period: AnalyticsPeriod, customFrom?: string, customTo?: string): Promise<{
    signups: number;
    activatedTrial: number;
    convertedToPaid: number;
    churned: number;
    trialConversionRate: number;
    overallConversionRate: number;
    avgDaysToConvert: number;
  }> {
    const range = this.buildRange(period, customFrom, customTo);
    const { data: signupData } = await this.supabase.from('tenants').select('id, created_at')
      .is('deleted_at', null)
      .gte('created_at', range.from.toISOString())
      .lte('created_at', range.to.toISOString());
    const signups = signupData?.length ?? 0;
    const tenantIds = (signupData ?? []).map((t: any) => t.id);
    if (tenantIds.length === 0) {
      return { signups: 0, activatedTrial: 0, convertedToPaid: 0, churned: 0, trialConversionRate: 0, overallConversionRate: 0, avgDaysToConvert: 0 };
    }
    const [{ data: trialData }, { data: paidData }, { data: churnedData }] = await Promise.all([
      this.supabase.from('subscriptions').select('tenant_id').in('tenant_id', tenantIds).in('status', ['trial', 'active', 'cancelled', 'expired']),
      this.supabase.from('subscriptions').select('tenant_id, started_at, plans!inner(price_monthly)').in('tenant_id', tenantIds).eq('status', 'active').gt('plans.price_monthly', 0),
      this.supabase.from('subscriptions').select('tenant_id, started_at, cancelled_at').in('tenant_id', tenantIds).in('status', ['cancelled', 'expired']).not('cancelled_at', 'is', null),
    ]);
    const activatedTrial = new Set((trialData ?? []).map((s: any) => s.tenant_id)).size;
    const convertedToPaid = new Set((paidData ?? []).map((s: any) => s.tenant_id)).size;
    const churned = new Set((churnedData ?? []).map((s: any) => s.tenant_id)).size;
    let avgDaysToConvert = 0;
    if (paidData && paidData.length > 0) {
      const signupMap = new Map((signupData ?? []).map((t: any) => [t.id, t.created_at]));
      const totalDays = (paidData as any[]).reduce((sum: number, s: any) => {
        const signupDate = signupMap.get(s.tenant_id);
        if (!signupDate) return sum;
        return sum + Math.max(0, Math.round((new Date(s.started_at).getTime() - new Date(signupDate).getTime()) / 86400000));
      }, 0);
      avgDaysToConvert = Math.round(totalDays / paidData.length);
    }
    return {
      signups, activatedTrial, convertedToPaid, churned,
      trialConversionRate: activatedTrial === 0 ? 0 : Math.round((convertedToPaid / activatedTrial) * 10000) / 100,
      overallConversionRate: signups === 0 ? 0 : Math.round((convertedToPaid / signups) * 10000) / 100,
      avgDaysToConvert,
    };
  }

  async getCohortAnalysis(): Promise<{ cohortMonth: string; size: number; retentionByMonth: { monthOffset: number; retained: number; rate: number }[] }[]> {
    const [{ data: tenants }, { data: subs }] = await Promise.all([
      this.supabase.from('tenants').select('id, created_at').is('deleted_at', null).order('created_at', { ascending: true }),
      this.supabase.from('subscriptions').select('tenant_id, status, started_at, ends_at, cancelled_at').in('status', ['active', 'cancelled', 'expired']),
    ]);
    if (!tenants || tenants.length === 0) return [];
    const subsMap = new Map<string, any[]>();
    for (const s of subs ?? []) {
      if (!subsMap.has(s.tenant_id)) subsMap.set(s.tenant_id, []);
      subsMap.get(s.tenant_id)!.push(s);
    }
    const cohortMap = new Map<string, string[]>();
    for (const t of tenants) {
      const d = new Date(t.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!cohortMap.has(key)) cohortMap.set(key, []);
      cohortMap.get(key)!.push(t.id);
    }
    const now = new Date();
    return Array.from(cohortMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([cohortMonth, tenantIds]) => {
        const [yr, mo] = cohortMonth.split('-').map(Number);
        const cohortStart = new Date(yr, mo - 1, 1);
        const maxOffset = Math.floor((now.getTime() - cohortStart.getTime()) / (86400000 * 30));
        const retentionByMonth = Array.from({ length: Math.min(maxOffset + 1, 12) }, (_, offset) => {
          const checkDate = new Date(yr, mo - 1 + offset, 1);
          const checkEnd = new Date(yr, mo + offset, 0);
          const retained = tenantIds.filter((tid) => {
            const tenantSubs = subsMap.get(tid) ?? [];
            return tenantSubs.some((s: any) => {
              const start = new Date(s.started_at);
              const end = s.cancelled_at ? new Date(s.cancelled_at) : s.ends_at ? new Date(s.ends_at) : now;
              return start <= checkEnd && end >= checkDate;
            });
          }).length;
          return { monthOffset: offset, retained, rate: Math.round((retained / tenantIds.length) * 10000) / 100 };
        });
        return { cohortMonth, size: tenantIds.length, retentionByMonth };
      });
  }

  async getRevenueByPlan(): Promise<{ planName: string; tenantCount: number; mrr: number; percentage: number }[]> {
    const { data } = await this.supabase
      .from('subscriptions')
      .select('plan_id, plans!inner(name, price_monthly)')
      .eq('status', 'active');
    if (!data) return [];
    const planMap = new Map<string, PlanEntry>();
    for (const row of data as any[]) {
      if (!planMap.has(row.plan_id)) {
        planMap.set(row.plan_id, { name: row.plans.name, price: row.plans.price_monthly, count: 0 });
      }
      planMap.get(row.plan_id)!.count++;
    }
    const totalMrr = Array.from(planMap.values()).reduce((s: number, p: PlanEntry) => s + p.price * p.count, 0);
    return Array.from(planMap.values()).map((plan: PlanEntry) => ({
      planName: plan.name,
      tenantCount: plan.count,
      mrr: plan.price * plan.count,
      percentage: totalMrr === 0 ? 0 : Math.round(((plan.price * plan.count) / totalMrr) * 10000) / 100,
    }));
  }

  async getUsageAnalytics(period: AnalyticsPeriod, customFrom?: string, customTo?: string): Promise<{
    tenantId: string;
    tenantName: string;
    invoicesCount: number;
    shiftsCount: number;
    expensesCount: number;
    usersCount: number;
    lastActivity: string | null;
  }[]> {
    const range = this.buildRange(period, customFrom, customTo);
    const { data: tenants } = await this.supabase.from('tenants').select('id, name').is('deleted_at', null).eq('status', 'active');
    if (!tenants) return [];
    const results = await Promise.all(
      (tenants as any[]).map(async (tenant: any) => {
        const [invoices, shifts, expenses, users, lastInvoice] = await Promise.all([
          this.supabase.from('orders').select('*', { count: 'exact', head: true }).eq('tenant_id', tenant.id).gte('created_at', range.from.toISOString()),
          this.supabase.from('shifts').select('*', { count: 'exact', head: true }).eq('tenant_id', tenant.id).gte('opened_at', range.from.toISOString()),
          this.supabase.from('expenses').select('*', { count: 'exact', head: true }).eq('tenant_id', tenant.id).gte('created_at', range.from.toISOString()),
          this.supabase.from('users').select('*', { count: 'exact', head: true }).eq('tenant_id', tenant.id).is('deleted_at', null),
          this.supabase.from('orders').select('created_at').eq('tenant_id', tenant.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
        ]);
        return {
          tenantId: tenant.id,
          tenantName: tenant.name,
          invoicesCount: invoices.count ?? 0,
          shiftsCount: shifts.count ?? 0,
          expensesCount: expenses.count ?? 0,
          usersCount: users.count ?? 0,
          lastActivity: (lastInvoice.data as any)?.created_at ?? null,
        };
      }),
    );
    return results.sort((a, b) => b.invoicesCount - a.invoicesCount);
  }
}