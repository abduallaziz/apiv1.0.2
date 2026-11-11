import { Module } from '@nestjs/common';
import { ExpenseDepartmentsController } from './expense-departments.controller';
import { ExpenseDepartmentsService } from './expense-departments.service';
import { ExpenseCategoriesV2Controller } from './expense-categories-v2.controller';
import { ExpenseCategoriesV2Service } from './expense-categories-v2.service';
import { ExpensesV2Controller } from './expenses-v2.controller';
import { ExpensesV2Service } from './expenses-v2.service';
import { ExpensesV2Scheduler } from './expenses-v2.scheduler';
import { ExpenseQuickDefinitionsController } from './expense-quick-definitions.controller';
import { ExpenseQuickDefinitionsService } from './expense-quick-definitions.service';
import { ExpenseActivityService } from './expense-activity.service';
import { ExpenseAttachmentsService } from './expense-attachments.service';

// New Expenses domain (Step 3: Department + Category administration; Step
// 4: Expense core; Step 5: Quick Expense; Step 6/Recurring Final
// Implementation: recurring behavior lives on expenses_v2 itself, no
// Template entity — see migration 201 and the Owner Decision it
// implements; Step 8: Activity History; Step 9: Backend API completion —
// search/filters + Attachments, per the locked Execution Protocol).
//
// `ExpenseRecurringTemplatesController`/`Service` (the revoked Template
// model) are deliberately NOT registered here — dead code, kept on disk
// only as historical reference, not deleted per explicit Owner instruction.
// `expense_recurring_templates` (the DB table) is likewise left in place,
// unreferenced by any code path after this change.
@Module({
  controllers: [
    ExpenseDepartmentsController,
    ExpenseCategoriesV2Controller,
    ExpensesV2Controller,
    ExpenseQuickDefinitionsController,
  ],
  providers: [
    ExpenseDepartmentsService,
    ExpenseCategoriesV2Service,
    ExpensesV2Service,
    ExpensesV2Scheduler,
    ExpenseQuickDefinitionsService,
    ExpenseActivityService,
    ExpenseAttachmentsService,
  ],
})
export class ExpensesV2Module {}
