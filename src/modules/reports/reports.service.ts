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
      // query.to is a bare date (e.g. "2026-06-28") with no time component.
      // Compared against a timestamptz, that parses as midnight at the START
      // of that day, silently excluding every event from that day onward.
      const toEndOfDay = /^\d{4}-\d{2}-\d{2}$/.test(query.to)
        ? `${query.to}T23:59:59.999`
        : query.to;
      return { from: query.from, to: toEndOfDay };
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

  // Card-network and wallet-provider methods settle identically to 'card'/'wallet' today
  // (no distinct gateway processing yet — see migration 006). Grouped here for the summary
  // buckets, while by_method below still exposes every exact value individually.
  private static readonly CARD_NETWORK_METHODS = ['card', 'mada', 'visa', 'mastercard'];
  private static readonly WALLET_METHODS = ['wallet', 'stc_pay', 'apple_pay'];

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

    const bucket = (methods: string[]) => {
      const matched = orders.filter(o => methods.includes(o.payment_method));
      return { count: matched.length, total: matched.reduce((s, o) => s + (o.total || 0), 0) };
    };

    const byMethod: Record<string, { count: number; total: number }> = {};
    for (const o of orders) {
      const m = o.payment_method || 'unknown';
      if (!byMethod[m]) byMethod[m] = { count: 0, total: 0 };
      byMethod[m].count++;
      byMethod[m].total += o.total || 0;
    }

    return {
      period: { from, to },
      summary: {
        total_orders: orders.length,
        grand_total: orders.reduce((s, o) => s + (o.total || 0), 0),
        cash: bucket(['cash']),
        card: bucket(ReportsService.CARD_NETWORK_METHODS),
        wallet: bucket(ReportsService.WALLET_METHODS),
        split: bucket(['split']),
        tab: bucket(['tab']),
      },
      by_method: byMethod,
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
    } else if (reportType === 'employees') {
      const typed = data as { employees: Record<string, unknown>[] };
      if (typed.employees.length > 0) {
        const keys = Object.keys(typed.employees[0]);
        sheet.columns = keys.map(k => ({ header: k, key: k, width: 20 }));
        sheet.getRow(1).eachCell(cell => Object.assign(cell, { style: headerStyle }));
        for (const row of typed.employees) sheet.addRow(row);
      }
    } else if (reportType === 'customers') {
      const typed = data as { customers: Record<string, unknown>[] };
      if (typed.customers.length > 0) {
        const keys = Object.keys(typed.customers[0]);
        sheet.columns = keys.map(k => ({ header: k, key: k, width: 20 }));
        sheet.getRow(1).eachCell(cell => Object.assign(cell, { style: headerStyle }));
        for (const row of typed.customers) sheet.addRow(row);
      }
    } else if (reportType === 'tax') {
      const typed = data as { daily_breakdown: Record<string, unknown>[] };
      if (typed.daily_breakdown.length > 0) {
        const keys = Object.keys(typed.daily_breakdown[0]);
        sheet.columns = keys.map(k => ({ header: k, key: k, width: 20 }));
        sheet.getRow(1).eachCell(cell => Object.assign(cell, { style: headerStyle }));
        for (const row of typed.daily_breakdown) sheet.addRow(row);
      }
    } else if (reportType === 'inventory') {
      const typed = data as { top_by_value: Record<string, unknown>[] };
      if (typed.top_by_value.length > 0) {
        const keys = Object.keys(typed.top_by_value[0]);
        sheet.columns = keys.map(k => ({ header: k, key: k, width: 20 }));
        sheet.getRow(1).eachCell(cell => Object.assign(cell, { style: headerStyle }));
        for (const row of typed.top_by_value) sheet.addRow(row);
      }
    } else if (reportType === 'cogs') {
      const typed = data as { top_by_cost: Record<string, unknown>[] };
      if (typed.top_by_cost.length > 0) {
        const keys = Object.keys(typed.top_by_cost[0]);
        sheet.columns = keys.map(k => ({ header: k, key: k, width: 20 }));
        sheet.getRow(1).eachCell(cell => Object.assign(cell, { style: headerStyle }));
        for (const row of typed.top_by_cost) sheet.addRow(row);
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
  async getTopItems(tenant: TenantContext, query: ReportQueryDto) {
    const { from, to } = this.getDateRange(query);

    const { data: orderItems, error } = await this.supabase
      .from('order_items')
      .select('item_id, item_name, qty, total_price, orders!inner(tenant_id, status, created_at)')
      .eq('orders.tenant_id', tenant.tenantId)
      .eq('orders.status', 'completed')
      .gte('orders.created_at', from)
      .lte('orders.created_at', to);

    if (error) throw error;

    const map: Record<string, { name: string; quantity: number; total: number }> = {};
    for (const row of orderItems ?? []) {
      const id = row.item_id ?? row.item_name;
      if (!map[id]) map[id] = { name: row.item_name, quantity: 0, total: 0 };
      map[id].quantity += row.qty ?? 0;
      map[id].total    += row.total_price ?? 0;
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

  async getEmployeesReport(tenant: TenantContext, query: ReportQueryDto) {
    const { from, to } = this.getDateRange(query);

    let q = this.supabase
      .from('orders')
      .select('id, total, cashier_id, branch_id, created_at')
      .eq('tenant_id', tenant.tenantId)
      .eq('status', 'completed')
      .gte('created_at', from)
      .lte('created_at', to)
      .not('cashier_id', 'is', null);

    if (query.branch_id) q = q.eq('branch_id', query.branch_id);

    const { data: orders, error } = await q;
    if (error) throw error;

    const cashierIds = [...new Set((orders ?? []).map(o => o.cashier_id))];
    const namesById: Record<string, string> = {};
    const commissionRateById: Record<string, number | null> = {};
    if (cashierIds.length > 0) {
      const { data: users } = await this.supabase
        .from('users')
        .select('id, name, commission_rate')
        .in('id', cashierIds);
      for (const u of users ?? []) {
        namesById[u.id] = u.name;
        commissionRateById[u.id] = u.commission_rate ?? null;
      }
    }

    const byCashier: Record<string, { name: string; order_count: number; total_sales: number }> = {};
    for (const o of orders ?? []) {
      const id = o.cashier_id as string;
      if (!byCashier[id]) byCashier[id] = { name: namesById[id] ?? 'Unknown', order_count: 0, total_sales: 0 };
      byCashier[id].order_count++;
      byCashier[id].total_sales += o.total || 0;
    }

    const employees = Object.entries(byCashier)
      .map(([cashier_id, v]) => {
        const commissionRate = commissionRateById[cashier_id] ?? null;
        return {
          cashier_id,
          name: v.name,
          order_count: v.order_count,
          total_sales: v.total_sales,
          avg_order_value: v.order_count > 0 ? v.total_sales / v.order_count : 0,
          commission_rate: commissionRate,
          commission_earned: commissionRate !== null ? parseFloat((v.total_sales * commissionRate).toFixed(2)) : null,
        };
      })
      .sort((a, b) => b.total_sales - a.total_sales);

    return { period: { from, to }, employees };
  }

  async getCustomersReport(tenant: TenantContext, query: ReportQueryDto) {
    const { from, to } = this.getDateRange(query);

    let q = this.supabase
      .from('orders')
      .select('id, total, customer_id, branch_id, created_at')
      .eq('tenant_id', tenant.tenantId)
      .eq('status', 'completed')
      .gte('created_at', from)
      .lte('created_at', to)
      .not('customer_id', 'is', null);

    if (query.branch_id) q = q.eq('branch_id', query.branch_id);

    const { data: orders, error } = await q;
    if (error) throw error;

    const customerIds = [...new Set((orders ?? []).map(o => o.customer_id))];
    const namesById: Record<string, string> = {};
    if (customerIds.length > 0) {
      const { data: customers } = await this.supabase
        .from('customers')
        .select('id, full_name')
        .in('id', customerIds);
      for (const c of customers ?? []) namesById[c.id] = c.full_name;
    }

    const byCustomer: Record<string, { name: string; order_count: number; total_spent: number }> = {};
    for (const o of orders ?? []) {
      const id = o.customer_id as string;
      if (!byCustomer[id]) byCustomer[id] = { name: namesById[id] ?? 'Unknown', order_count: 0, total_spent: 0 };
      byCustomer[id].order_count++;
      byCustomer[id].total_spent += o.total || 0;
    }

    const customers = Object.entries(byCustomer)
      .map(([customer_id, v]) => ({
        customer_id,
        name: v.name,
        order_count: v.order_count,
        total_spent: v.total_spent,
        avg_order_value: v.order_count > 0 ? v.total_spent / v.order_count : 0,
      }))
      .sort((a, b) => b.total_spent - a.total_spent);

    return {
      period: { from, to },
      summary: { unique_customers: customers.length },
      customers,
    };
  }

  async getDailyReconciliation(tenant: TenantContext, date: string, branchId?: string) {
    const from = `${date}T00:00:00.000`;
    const to = `${date}T23:59:59.999`;

    let ordersQ = this.supabase
      .from('orders')
      .select('id, total, payment_method, branch_id')
      .eq('tenant_id', tenant.tenantId)
      .eq('status', 'completed')
      .gte('created_at', from)
      .lte('created_at', to);
    if (branchId) ordersQ = ordersQ.eq('branch_id', branchId);

    let expensesQ = this.supabase
      .from('expenses')
      .select('id, amount, branch_id')
      .eq('tenant_id', tenant.tenantId)
      .eq('status', 'approved')
      .gte('created_at', from)
      .lte('created_at', to)
      .is('deleted_at', null);
    if (branchId) expensesQ = expensesQ.eq('branch_id', branchId);

    // Shifts are reconciled per-shift by ShiftEngine at close time (expected_cash/discrepancy
    // already account for cash sales + expenses within that shift) — this aggregates those
    // already-correct per-shift figures instead of recomputing cash math from scratch.
    let shiftsQ = this.supabase
      .from('shifts')
      .select('id, branch_id, status, opening_cash, closing_cash, expected_cash, discrepancy')
      .eq('tenant_id', tenant.tenantId)
      .eq('status', 'closed')
      .gte('closed_at', from)
      .lte('closed_at', to)
      .is('deleted_at', null);
    if (branchId) shiftsQ = shiftsQ.eq('branch_id', branchId);

    const [{ data: orders, error: ordersErr }, { data: expenses, error: expensesErr }, { data: shifts, error: shiftsErr }] =
      await Promise.all([ordersQ, expensesQ, shiftsQ]);
    if (ordersErr) throw ordersErr;
    if (expensesErr) throw expensesErr;
    if (shiftsErr) throw shiftsErr;

    const byPaymentMethod: Record<string, { count: number; total: number }> = {};
    for (const o of orders ?? []) {
      const m = o.payment_method || 'unknown';
      if (!byPaymentMethod[m]) byPaymentMethod[m] = { count: 0, total: 0 };
      byPaymentMethod[m].count++;
      byPaymentMethod[m].total += o.total || 0;
    }

    return {
      date,
      sales: {
        total_orders: (orders ?? []).length,
        total_revenue: (orders ?? []).reduce((s, o) => s + (o.total || 0), 0),
        by_payment_method: byPaymentMethod,
      },
      expenses: {
        approved_count: (expenses ?? []).length,
        total_approved_amount: (expenses ?? []).reduce((s, e) => s + (e.amount || 0), 0),
      },
      cash_shifts: {
        closed_shift_count: (shifts ?? []).length,
        total_opening_cash: (shifts ?? []).reduce((s, sh) => s + (sh.opening_cash || 0), 0),
        total_closing_cash: (shifts ?? []).reduce((s, sh) => s + (sh.closing_cash || 0), 0),
        total_expected_cash: (shifts ?? []).reduce((s, sh) => s + (sh.expected_cash || 0), 0),
        total_discrepancy: (shifts ?? []).reduce((s, sh) => s + (sh.discrepancy || 0), 0),
      },
    };
  }

  async getTaxReport(tenant: TenantContext, query: ReportQueryDto) {
    const { from, to } = this.getDateRange(query);

    let q = this.supabase
      .from('orders')
      .select('id, subtotal, tax, total, branch_id, created_at')
      .eq('tenant_id', tenant.tenantId)
      .eq('status', 'completed')
      .gte('created_at', from)
      .lte('created_at', to);

    if (query.branch_id) q = q.eq('branch_id', query.branch_id);

    const { data: orders, error } = await q;
    if (error) throw error;

    const taxRate = await this.getTenantTaxRate(tenant.tenantId);

    const byDay: Record<string, { subtotal: number; tax: number; total: number; order_count: number }> = {};
    for (const o of orders ?? []) {
      const day = o.created_at.substring(0, 10);
      if (!byDay[day]) byDay[day] = { subtotal: 0, tax: 0, total: 0, order_count: 0 };
      byDay[day].subtotal += o.subtotal || 0;
      byDay[day].tax += o.tax || 0;
      byDay[day].total += o.total || 0;
      byDay[day].order_count++;
    }

    return {
      period: { from, to },
      tax_rate: taxRate,
      summary: {
        total_orders: (orders ?? []).length,
        total_subtotal: (orders ?? []).reduce((s, o) => s + (o.subtotal || 0), 0),
        total_tax_collected: (orders ?? []).reduce((s, o) => s + (o.tax || 0), 0),
        grand_total: (orders ?? []).reduce((s, o) => s + (o.total || 0), 0),
      },
      daily_breakdown: Object.entries(byDay)
        .map(([date, v]) => ({ date, ...v }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    };
  }

  private async getTenantTaxRate(tenantId: string): Promise<number> {
    const { data } = await this.supabase
      .from('tenants')
      .select('tax_rate')
      .eq('id', tenantId)
      .single();
    return data?.tax_rate ?? 0;
  }

  async getCogsReport(tenant: TenantContext, query: ReportQueryDto) {
    const { from, to } = this.getDateRange(query);

    const { data: movements, error } = await this.supabase
      .from('stock_movements')
      .select('item_id, quantity, unit_cost, total_cost')
      .eq('tenant_id', tenant.tenantId)
      .eq('movement_type', 'sale')
      .gte('occurred_at', from)
      .lte('occurred_at', to);
    if (error) throw error;

    const totalCogs = (movements ?? []).reduce((s, m) => s + (m.total_cost || 0), 0);

    const byItem: Record<string, { quantity: number; total_cost: number }> = {};
    for (const m of movements ?? []) {
      if (!byItem[m.item_id]) byItem[m.item_id] = { quantity: 0, total_cost: 0 };
      byItem[m.item_id].quantity += m.quantity || 0;
      byItem[m.item_id].total_cost += m.total_cost || 0;
    }

    const itemIds = Object.keys(byItem);
    const namesById: Record<string, string> = {};
    if (itemIds.length > 0) {
      const { data: items } = await this.supabase.from('items').select('id, name').in('id', itemIds);
      for (const i of items ?? []) namesById[i.id] = i.name;
    }

    const topByCost = Object.entries(byItem)
      .map(([item_id, v]) => ({
        item_id,
        item_name: namesById[item_id] ?? 'Unknown',
        quantity_sold: v.quantity,
        total_cost: v.total_cost,
      }))
      .sort((a, b) => b.total_cost - a.total_cost)
      .slice(0, 10);

    let ordersQ = this.supabase
      .from('orders')
      .select('total')
      .eq('tenant_id', tenant.tenantId)
      .eq('status', 'completed')
      .gte('created_at', from)
      .lte('created_at', to);
    if (query.branch_id) ordersQ = ordersQ.eq('branch_id', query.branch_id);
    const { data: orders, error: ordersErr } = await ordersQ;
    if (ordersErr) throw ordersErr;

    const totalRevenue = (orders ?? []).reduce((s, o) => s + (o.total || 0), 0);
    const grossProfit = totalRevenue - totalCogs;

    return {
      period: { from, to },
      summary: {
        total_cogs: totalCogs,
        total_revenue: totalRevenue,
        gross_profit: grossProfit,
        gross_margin_pct: totalRevenue > 0 ? parseFloat(((grossProfit / totalRevenue) * 100).toFixed(1)) : 0,
      },
      top_by_cost: topByCost,
      // COGS only reflects items with has_inventory=true sold at a branch with a
      // default_warehouse_id configured (see STATUS.md §64) — revenue from any other item
      // is still counted above, so gross_margin_pct understates true margin for tenants who
      // haven't fully configured inventory tracking on all their sellable items.
      coverage_note:
        'COGS only includes items with inventory tracking enabled, sold at a branch with a warehouse configured. Revenue includes all sales, so margin may be understated until inventory tracking is fully configured.',
    };
  }

  async getInventoryReport(tenant: TenantContext, warehouseId?: string) {
    const { data, error } = await this.supabase.rpc('fn_inventory_stock_levels_enriched', {
      p_tenant_id: tenant.tenantId,
      p_warehouse_id: warehouseId ?? null,
      p_item_id: null,
      p_category_id: null,
      p_location_id: null,
      p_batch_id: null,
      p_supplier_id: null,
      p_status: null,
    });
    if (error) throw error;

    const rows = data ?? [];
    const totalValue = rows.reduce((s: number, r: any) => s + (r.inventory_value || 0), 0);
    const lowStockCount = rows.filter((r: any) => r.status === 'low_stock').length;
    const outOfStockCount = rows.filter((r: any) => r.status === 'out_of_stock').length;

    const topByValue = [...rows]
      .sort((a: any, b: any) => (b.inventory_value || 0) - (a.inventory_value || 0))
      .slice(0, 10)
      .map((r: any) => ({
        item_name: r.item_name,
        warehouse_name: r.warehouse_name,
        quantity_on_hand: r.quantity_on_hand,
        inventory_value: r.inventory_value,
        status: r.status,
      }));

    return {
      summary: {
        total_sku_count: rows.length,
        total_inventory_value: totalValue,
        low_stock_count: lowStockCount,
        out_of_stock_count: outOfStockCount,
      },
      top_by_value: topByValue,
    };
  }

  private async getOrderMetrics(tenantId: string, from: string, to: string, branchId?: string) {
    let q = this.supabase
      .from('orders')
      .select('id, total, customer_id, branch_id, created_at')
      .eq('tenant_id', tenantId)
      .eq('status', 'completed')
      .gte('created_at', from)
      .lte('created_at', to);

    if (branchId) q = q.eq('branch_id', branchId);

    const { data: orders, error } = await q;
    if (error) throw error;

    const totalRevenue = (orders ?? []).reduce((s, o) => s + (o.total || 0), 0);
    const orderCount = (orders ?? []).length;

    return {
      revenue: totalRevenue,
      order_count: orderCount,
      avg_order_value: orderCount > 0 ? totalRevenue / orderCount : 0,
      unique_customers: new Set((orders ?? []).map((o) => o.customer_id).filter(Boolean)).size,
    };
  }

  private percentChange(current: number, previous: number): number | null {
    if (previous === 0) return current === 0 ? 0 : null; // undefined growth from a zero base
    return parseFloat((((current - previous) / previous) * 100).toFixed(1));
  }

  async getPeriodComparison(tenant: TenantContext, query: ReportQueryDto) {
    const { from, to } = this.getDateRange(query);
    const currentFromMs = new Date(from).getTime();
    const currentToMs = new Date(to).getTime();
    const durationMs = currentToMs - currentFromMs;

    const previousFrom = new Date(currentFromMs - durationMs).toISOString();
    const previousTo = new Date(currentFromMs - 1).toISOString();

    const [current, previous] = await Promise.all([
      this.getOrderMetrics(tenant.tenantId, from, to, query.branch_id),
      this.getOrderMetrics(tenant.tenantId, previousFrom, previousTo, query.branch_id),
    ]);

    return {
      current_period: { from, to, ...current },
      previous_period: { from: previousFrom, to: previousTo, ...previous },
      change: {
        revenue_pct: this.percentChange(current.revenue, previous.revenue),
        order_count_pct: this.percentChange(current.order_count, previous.order_count),
        avg_order_value_pct: this.percentChange(current.avg_order_value, previous.avg_order_value),
      },
    };
  }

  async getBranchComparison(tenant: TenantContext, query: ReportQueryDto) {
    const { from, to } = this.getDateRange(query);

    const { data: branches, error: branchError } = await this.supabase
      .from('branches')
      .select('id, name')
      .eq('tenant_id', tenant.tenantId)
      .is('deleted_at', null);
    if (branchError) throw branchError;

    const results = await Promise.all(
      (branches ?? []).map(async (b) => ({
        branch_id: b.id,
        branch_name: b.name,
        ...(await this.getOrderMetrics(tenant.tenantId, from, to, b.id)),
      })),
    );

    return {
      period: { from, to },
      branches: results.sort((a, b) => b.revenue - a.revenue),
    };
  }

  async getCustomerChurn(tenant: TenantContext, query: ReportQueryDto) {
    const { from, to } = this.getDateRange(query);
    const currentFromMs = new Date(from).getTime();
    const durationMs = new Date(to).getTime() - currentFromMs;
    const previousFrom = new Date(currentFromMs - durationMs).toISOString();
    const previousTo = new Date(currentFromMs - 1).toISOString();

    const [currentOrders, previousOrders] = await Promise.all([
      this.supabase
        .from('orders')
        .select('customer_id')
        .eq('tenant_id', tenant.tenantId)
        .eq('status', 'completed')
        .gte('created_at', from)
        .lte('created_at', to)
        .not('customer_id', 'is', null),
      this.supabase
        .from('orders')
        .select('customer_id')
        .eq('tenant_id', tenant.tenantId)
        .eq('status', 'completed')
        .gte('created_at', previousFrom)
        .lte('created_at', previousTo)
        .not('customer_id', 'is', null),
    ]);

    if (currentOrders.error) throw currentOrders.error;
    if (previousOrders.error) throw previousOrders.error;

    const currentCustomers = new Set((currentOrders.data ?? []).map((o) => o.customer_id));
    const previousCustomers = new Set((previousOrders.data ?? []).map((o) => o.customer_id));

    const churnedCustomerIds = [...previousCustomers].filter((id) => !currentCustomers.has(id));

    return {
      current_period: { from, to },
      previous_period: { from: previousFrom, to: previousTo },
      previous_period_customers: previousCustomers.size,
      current_period_customers: currentCustomers.size,
      churned_customers: churnedCustomerIds.length,
      churn_rate_pct: previousCustomers.size > 0
        ? parseFloat(((churnedCustomerIds.length / previousCustomers.size) * 100).toFixed(1))
        : 0,
    };
  }
}