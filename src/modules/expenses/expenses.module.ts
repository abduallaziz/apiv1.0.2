import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';
import { ExpenseTemplatesController } from './expense-templates.controller';
import { ExpenseTemplatesService } from './expense-templates.service';
import { ExpenseCategoriesController } from './expense-categories.controller';
import { ExpenseCategoriesService } from './expense-categories.service';
import { ExpensesScheduler } from './expenses.scheduler';
import { ExpenseEngineModule } from '../../engines/expense-engine/expense-engine.module';
import { ApprovalEngineModule } from '../../engines/approval-engine/approval-engine.module';
import { PermissionsModule } from '../../core/permissions/permissions.module';
import { AuditInterceptor } from '../../core/audit/audit.interceptor';

@Module({
  imports: [ExpenseEngineModule, ApprovalEngineModule, PermissionsModule],
  controllers: [ExpensesController, ExpenseTemplatesController, ExpenseCategoriesController],
  providers: [
    ExpensesService,
    ExpenseTemplatesService,
    ExpenseCategoriesService,
    ExpensesScheduler,
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
  exports: [ExpensesService],
})
export class ExpensesModule {}