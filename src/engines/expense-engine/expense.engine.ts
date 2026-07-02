import { Injectable } from '@nestjs/common';

export interface ExpenseRequestData {
  tenantId: string;
  branchId: string;
  requestedBy: string;
  templateId?: string;
  templateName?: string;
  amount: number;
  note?: string;
  photoUrl?: string;
  expiryHours: number;
}

export interface ExpenseSummary {
  total: number;
  approved: number;
  rejected: number;
  pending: number;
  expired: number;
  byCategory: Record<string, number>;
}

@Injectable()
export class ExpenseEngine {
  buildExpenseRequest(data: ExpenseRequestData): {
    tenant_id: string;
    branch_id: string;
    requested_by: string;
    template_id: string | null;
    title: string;
    amount: number;
    notes: string | null;
    photo_url: string | null;
    status: string;
    expires_at: string;
  } {
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + data.expiryHours);

    // title: templateName → note → null (caller provides localized fallback)
    const title = data.templateName ?? data.note ?? null;

    return {
      tenant_id: data.tenantId,
      branch_id: data.branchId,
      requested_by: data.requestedBy,
      template_id: data.templateId ?? null,
      title: title ?? '',
      amount: data.amount,
      notes: data.note ?? null,
      photo_url: data.photoUrl ?? null,
      status: 'pending',
      expires_at: expiresAt.toISOString(),
    };
  }

  isExpired(expiresAt: string): boolean {
    return new Date() > new Date(expiresAt);
  }

  buildSummary(expenses: Array<{ status: string; amount: number }>): ExpenseSummary {
    const summary: ExpenseSummary = {
      total: 0,
      approved: 0,
      rejected: 0,
      pending: 0,
      expired: 0,
      byCategory: {},
    };

    for (const exp of expenses) {
      summary.total += exp.amount;
      if (exp.status === 'approved') summary.approved += exp.amount;
      if (exp.status === 'rejected') summary.rejected += exp.amount;
      if (exp.status === 'pending') summary.pending += exp.amount;
      if (exp.status === 'expired') summary.expired += exp.amount;
    }

    return summary;
  }
}