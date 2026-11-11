import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';

export type ExpenseActivityAction =
  | 'created'
  | 'edited'
  | 'payment_confirmed'
  | 'cancelled'
  | 'accepted'
  | 'rejected'
  | 'department_changed';

const SELECT = 'id, expense_id, actor_id, action, note, created_at';

// Activity History (Step 8 of the locked Execution Protocol) — an
// append-only log written on every Expense state transition. Logging
// failures are swallowed (logged, not thrown) so a history-write hiccup
// can never block the actual business transition it's recording — the
// log is observational, never load-bearing.
@Injectable()
export class ExpenseActivityService {
  private readonly logger = new Logger(ExpenseActivityService.name);

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async log(
    tenantId: string,
    expenseId: string,
    actorId: string | null,
    action: ExpenseActivityAction,
    note?: string,
  ): Promise<void> {
    const { error } = await this.supabase.from('expense_activity').insert({
      tenant_id: tenantId,
      expense_id: expenseId,
      actor_id: actorId,
      action,
      note: note ?? null,
    });
    if (error) {
      this.logger.error(
        `Failed to log activity '${action}' for expense ${expenseId}: ${error.message}`,
      );
    }
  }

  async findByExpense(tenantId: string, expenseId: string) {
    const { data, error } = await this.supabase
      .from('expense_activity')
      .select(SELECT)
      .eq('expense_id', expenseId)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data ?? [];
  }
}
