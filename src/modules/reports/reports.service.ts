import { Injectable, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';
import { TenantContext } from '../../core/tenant/tenant-context';
import { ReportQueryDto, ReportPeriod, ExportFormat } from './dto/report-query.dto';
import * as ExcelJS from 'exceljs';

@Injectable()
export class ReportsService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  private getDateRange(query: ReportQueryDto): { from: string; to: string } {
    const now = new Date();
    const to = now.toISOString();

    if (query.period === ReportPeriod.CUSTOM && query.from && query.to) {
      return { from: query.from, to: query.to };
    }

    const from = new Date(now);
    switch (query.period) {
      case ReportPeriod.TODAY:
        from.setHours(0, 0, 0, 0);
        break;
      case ReportPeriod.WEEK:
        from.setDate(now.getDate() - 7);
        break;
      case ReportPeriod.MONTH:
      default:
        from.setMonth(now.getMonth() - 1);
        break;
    }

    return { from: from.toISOString(), to };
  }

  async getRevenueReport(tenant: TenantContext, query: ReportQueryDto) {
    const { from, to } = this.getDateRange(query);

    let q = this.supabase
      .from('orders')
      .select('id, total, subtotal, discount, tax, payment_method, created_at, branch_id')
      .eq('tenant_id', tenant.tenantId)
      .eq('status', 'completed')
      .gte('created_at', from)
      .lte('created_at', to);

    if (query.branch_id) q = q.eq('branch_id', query.branch_id);

    const { data: orders, error } = await q;
    if (error) throw error;

    const totalRevenue = orders.reduce((s, o) => s + (o.total || 0), 0);
    const totalDiscount = orders.reduce((s, o) => s + (o.discount || 0), 0);
    const totalTax = orders.reduce((s, o) => s + (o.tax || 0), 0);

    const byPaymentMethod: Record<string, { count: number; total: number }> = {};
    for (const o of orders) {
      const m = o.payment_method || 'unknown';
      if (!byPaymentMethod[m]) byPaymentMethod[m] = { count: 0, total: 0 };
      byPaymentMethod[m].count++;
      byPaymentMethod[m].total += o.total || 0;
    }

    const byDay: Record<string, number> = {};
    for (const o of orders) {
      const day = o.created_at.substring(0, 10);
      byDay[day] = (byDay[day] || 0) + (o.total || 0);
    }

    return {
      period: { from, to },
      summary: {
        total_revenue: totalRevenue,
        total_orders: orders.length,
        total_discount: totalDiscount,
        total_tax: totalTax,
        avg_order_value: orders.length > 0 ? totalRevenue / orders.length : 0,
      },
      by_payment_method: byPaymentMethod,
      daily_breakdown: Object.entries(byDay)
        .map(([date, total]) => ({ date, total }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    };
  }

  async getShiftsReport(tenant: TenantContext, query: ReportQueryDto) {
    const { from, to } = this.getDateRange(query);

    let q = this.supabase
      .from('shifts')
      .select('id, cashier_id, branch_id, status, opening_cash, closing_cash, expected_cash, discrepancy, opened_at, closed_at')
      .eq('tenant_id', tenant.tenantId)
      .gte('opened_at', from)
      .lte('opened_at', to)
      .is('deleted_at', null);

    if (query.branch_id) q = q.eq('branch_id', query.branch_id);

    const { data: shifts, error } = await q;
    if (error) throw error;

    const closed = shifts.filter(s => s.status === 'closed');
    const totalDiscrepancy = closed.reduce((s, sh) => s + Math.abs(sh.discrepancy || 0), 0);

    return {
      period: { from, to },
      summary: {
        total_shifts: shifts.length,
        closed_shifts: closed.length,
        open_shifts: shifts.filter(s => s.status === 'open').length,
        total_discrepancy: totalDiscrepancy,
        avg_discrepancy: closed.length > 0 ? totalDiscrepancy / closed.length : 0,
      },
      shifts: shifts.map(s => ({
        id: s.id,
        cashier_id: s.cashier_id,
        branch_id: s.branch_id,
        status: s.status,
        opening_cash: s.opening_cash,
        closing_cash: s.closing_cash,
        expected_cash: s.expected_cash,
        discrepancy: s.discrepancy,
        opened_at: s.opened_at,
        closed_at: s.closed_at,
      })),
    };
  }

  async getExpensesReport(tenant: TenantContext, query: ReportQueryDto) {
    const { from, to } = this.getDateRange(query);

    let q = this.supabase
      .from('expenses')
      .select('id, amount, status, notes, created_at, branch_id, template_id, requested_by, approved_by, resolved_at')
      .eq('tenant_id', tenant.tenantId)
      .gte('created_at', from)
      .lte('created_at', to)
      .is('deleted_at', null);

    if (query.branch_id) q = q.eq('branch_id', query.branch_id);

    const { data: expenses, error } = await q;
    if (error) throw error;

    const approved = expenses.filter(e => e.status === 'approved');
    const rejected = expenses.filter(e => e.status === 'rejected');
    const pending = expenses.filter(e => e.status === 'pending');
    const totalApproved = approved.reduce((s, e) => s + (e.amount || 0), 0);

    return {
      period: { from, to },
      summary: {
        total_requests: expenses.length,
        approved_count: approved.length,
        rejected_count: rejected.length,
        pending_count: pending.length,
        total_approved_amount: totalApproved,
      },
      expenses: expenses.map(e => ({
        id: e.id,
        amount: e.amount,
        status: e.status,
        notes: e.notes,
        branch_id: e.branch_id,
        requested_by: e.requested_by,
        approved_by: e.approved_by,
        created_at: e.created_at,
        resolved_at: e.resolved_at,
      })),
    };
  }

  async getPaymentsReport(tenant: TenantContext, query: ReportQueryDto) {
    const { from, to } = this.getDateRange(query);

    let q = this.supabase
      .from('orders')
      .select('id, total, payment_method, branch_id, created_at, cashier_id')
      .eq('tenant_id', tenant.tenantId)
      .eq('status', 'completed')
      .gte('created_at', from)
      .lte('created_at', to);

    if (query.branch_id) q = q.eq('branch_id', query.branch_id);

    const { data: orders, error } = await q;
    if (error) throw error;

    const cashOrders = orders.filter(o => o.payment_method === 'cash');
    const cardOrders = orders.filter(o => o.payment_method === 'card');
    const splitOrders = orders.filter(o => o.payment_method === 'split');

    return {
      period: { from, to },
      summary: {
        total_orders: orders.length,
        grand_total: orders.reduce((s, o) => s + (o.total || 0), 0),
        cash: { count: cashOrders.length, total: cashOrders.reduce((s, o) => s + (o.total || 0), 0) },
        card: { count: cardOrders.length, total: cardOrders.reduce((s, o) => s + (o.total || 0), 0) },
        split: { count: splitOrders.length, total: splitOrders.reduce((s, o) => s + (o.total || 0), 0) },
      },
    };
  }

  async exportToExcel(reportType: string, data: Record<string, unknown>): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Sefay V1.02';
    workbook.created = new Date();

    const headerStyle: Partial<ExcelJS.Style> = {
      font: { bold: true, color: { argb: 'FFFFFFFF' } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E2130' } },
      alignment: { horizontal: 'center' },
    };

    const sheet = workbook.addWorksheet(reportType);

    if (reportType === 'revenue') {
      const typed = data as { summary: Record<string, number>; daily_breakdown: { date: string; total: number }[] };
      sheet.columns = [
        { header: 'Date', key: 'date', width: 20 },
        { header: 'Total Revenue', key: 'total', width: 20 },
      ];
      sheet.getRow(1).eachCell(cell => Object.assign(cell, { style: headerStyle }));
      for (const row of typed.daily_breakdown) sheet.addRow(row);

      const summarySheet = workbook.addWorksheet('Summary');
      summarySheet.columns = [
        { header: 'Metric', key: 'metric', width: 30 },
        { header: 'Value', key: 'value', width: 20 },
      ];
      summarySheet.getRow(1).eachCell(cell => Object.assign(cell, { style: headerStyle }));
      for (const [key, value] of Object.entries(typed.summary)) {
        summarySheet.addRow({ metric: key, value });
      }
    } else if (reportType === 'shifts') {
      const typed = data as { shifts: Record<string, unknown>[] };
      if (typed.shifts.length > 0) {
        const keys = Object.keys(typed.shifts[0]);
        sheet.columns = keys.map(k => ({ header: k, key: k, width: 20 }));
        sheet.getRow(1).eachCell(cell => Object.assign(cell, { style: headerStyle }));
        for (const row of typed.shifts) sheet.addRow(row);
      }
    } else if (reportType === 'expenses') {
      const typed = data as { expenses: Record<string, unknown>[] };
      if (typed.expenses.length > 0) {
        const keys = Object.keys(typed.expenses[0]);
        sheet.columns = keys.map(k => ({ header: k, key: k, width: 20 }));
        sheet.getRow(1).eachCell(cell => Object.assign(cell, { style: headerStyle }));
        for (const row of typed.expenses) sheet.addRow(row);
      }
    } else if (reportType === 'payments') {
      const typed = data as { summary: Record<string, unknown> };
      const rows = Object.entries(typed.summary).map(([metric, value]) => ({ metric, value }));
      sheet.columns = [
        { header: 'Metric', key: 'metric', width: 30 },
        { header: 'Value', key: 'value', width: 20 },
      ];
      sheet.getRow(1).eachCell(cell => Object.assign(cell, { style: headerStyle }));
      for (const row of rows) sheet.addRow(row);
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
  async getTopItems(tenant: TenantContext, query: ReportQueryDto) {
    const { from, to } = this.getDateRange(query);

    const { data: orderItems, error } = await this.supabase
      .from('order_items')
      .select('item_id, item_name, quantity, total, orders!inner(tenant_id, status, created_at)')
      .eq('orders.tenant_id', tenant.tenantId)
      .eq('orders.status', 'completed')
      .gte('orders.created_at', from)
      .lte('orders.created_at', to);

    if (error) throw error;

    const map: Record<string, { name: string; quantity: number; total: number }> = {};
    for (const row of orderItems ?? []) {
      const id = row.item_id ?? row.item_name;
      if (!map[id]) map[id] = { name: row.item_name, quantity: 0, total: 0 };
      map[id].quantity += row.quantity ?? 0;
      map[id].total    += row.total    ?? 0;
    }

    const items = Object.values(map)
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    const maxTotal = items[0]?.total ?? 1;

    return {
      items: items.map(i => ({
        name:     i.name,
        quantity: i.quantity,
        total:    i.total,
        pct:      Math.round((i.total / maxTotal) * 100),
      })),
    };
  }

  async getRecentActivity(tenant: TenantContext) {
    const { data: orders, error: oErr } = await this.supabase
      .from('orders')
      .select('id, total, payment_method, status, created_at')
      .eq('tenant_id', tenant.tenantId)
      .in('status', ['completed', 'cancelled'])
      .order('created_at', { ascending: false })
      .limit(10);

    if (oErr) throw oErr;

    const { data: lowStock, error: lErr } = await this.supabase
      .from('items')
      .select('id, name, stock_quantity, low_stock_threshold')
      .eq('tenant_id', tenant.tenantId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .not('stock_quantity', 'is', null)
      .not('low_stock_threshold', 'is', null)
      .limit(5);

    if (lErr) throw lErr;

    const activity: {
      type: 'order' | 'refund' | 'alert'
      title: string
      sub: string
      amount: number | null
      time: string
    }[] = [];

    for (const o of orders ?? []) {
      activity.push({
        type:   o.status === 'cancelled' ? 'refund' : 'order',
        title:  `فاتورة #${o.id.slice(-4).toUpperCase()}`,
        sub:    o.payment_method ?? 'cash',
        amount: o.status === 'cancelled' ? -(o.total ?? 0) : (o.total ?? 0),
        time:   o.created_at,
      });
    }

    for (const item of lowStock ?? []) {
      if ((item.stock_quantity ?? 0) <= (item.low_stock_threshold ?? 0)) {
        activity.push({
          type:   'alert',
          title:  `مخزون منخفض — ${item.name}`,
          sub:    `كمية متبقية: ${item.stock_quantity}`,
          amount: null,
          time:   new Date().toISOString(),
        });
      }
    }

    activity.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

    return { activity: activity.slice(0, 8) };
  }

  async getSparklines(tenant: TenantContext) {
    const days: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push(d.toISOString().substring(0, 10));
    }

    const from = days[0] + 'T00:00:00.000Z';
    const to   = days[6] + 'T23:59:59.999Z';

    const { data: orders, error: oErr } = await this.supabase
      .from('orders')
      .select('total, created_at')
      .eq('tenant_id', tenant.tenantId)
      .eq('status', 'completed')
      .gte('created_at', from)
      .lte('created_at', to);

    if (oErr) throw oErr;

    const { data: customers, error: cErr } = await this.supabase
      .from('customers')
      .select('created_at')
      .eq('tenant_id', tenant.tenantId)
      .gte('created_at', from)
      .lte('created_at', to);

    if (cErr) throw cErr;

    const { data: expenses, error: eErr } = await this.supabase
      .from('expenses')
      .select('amount, created_at')
      .eq('tenant_id', tenant.tenantId)
      .eq('status', 'approved')
      .gte('created_at', from)
      .lte('created_at', to)
      .is('deleted_at', null);

    if (eErr) throw eErr;

    const salesMap:     Record<string, number> = {};
    const ordersMap:    Record<string, number> = {};
    const customersMap: Record<string, number> = {};
    const expensesMap:  Record<string, number> = {};

    for (const d of days) {
      salesMap[d] = 0; ordersMap[d] = 0;
      customersMap[d] = 0; expensesMap[d] = 0;
    }

    for (const o of orders ?? []) {
      const d = o.created_at.substring(0, 10);
      if (salesMap[d] !== undefined) {
        salesMap[d]  += o.total ?? 0;
        ordersMap[d] += 1;
      }
    }
    for (const c of customers ?? []) {
      const d = c.created_at.substring(0, 10);
      if (customersMap[d] !== undefined) customersMap[d] += 1;
    }
    for (const e of expenses ?? []) {
      const d = e.created_at.substring(0, 10);
      if (expensesMap[d] !== undefined) expensesMap[d] += e.amount ?? 0;
    }

    return {
      sales:     days.map(d => salesMap[d]),
      orders:    days.map(d => ordersMap[d]),
      customers: days.map(d => customersMap[d]),
      expenses:  days.map(d => expensesMap[d]),
    };
  }
}