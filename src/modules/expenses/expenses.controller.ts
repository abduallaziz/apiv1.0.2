import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { PaginationDto } from '../../shared/dto/pagination.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { Audit } from '../../core/audit/audit.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';
import { ExpensesService } from './expenses.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { RejectExpenseDto } from './dto/reject-expense.dto';
import { QueryExpensesDto } from './dto/query-expenses.dto';

@Controller('expenses')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @Get('stats')
  @RequirePermission('expenses.view')
  getStats(
    @GetTenant() tenant: TenantContext,
    @Request() req: any,
    @Query('branch_id') branchId?: string,
  ) {
    const tenantId = tenant?.tenantId ?? req.user.tenant_id;
    return this.expensesService.getStats(tenantId, branchId);
  }

  @Get()
  @RequirePermission('expenses.view')
  findAll(
    @GetTenant() tenant: TenantContext,
    @Query() query: QueryExpensesDto,
    @Query('page') page?: string,
    @Query('per_page') perPage?: string,
    @Request() req?: any,
  ) {
    const tenantId = tenant?.tenantId ?? req.user.tenant_id;
    return this.expensesService.findAll(tenantId, query, new PaginationDto(page, perPage));
  }

  @Get(':id')
  @RequirePermission('expenses.view')
  findOne(
    @Param('id') id: string,
    @GetTenant() tenant: TenantContext,
    @Request() req: any,
  ) {
    const tenantId = tenant?.tenantId ?? req.user.tenant_id;
    return this.expensesService.findOne(id, tenantId);
  }

  @Post()
  @Audit('expense.request')
  @RequirePermission('expense.request')
  create(
    @Body() dto: CreateExpenseDto,
    @GetTenant() tenant: TenantContext,
    @Request() req: any,
  ) {
    const tenantId = tenant?.tenantId ?? req.user.tenant_id;
    return this.expensesService.create(dto, tenantId, req.user.sub);
  }

  @Patch(':id/approve')
  @Audit('expense.approve')
  @RequirePermission('expense.approve')
  approve(
    @Param('id') id: string,
    @GetTenant() tenant: TenantContext,
    @Request() req: any,
  ) {
    const tenantId = tenant?.tenantId ?? req.user.tenant_id;
    return this.expensesService.approve(id, tenantId, req.user.sub);
  }

  @Patch(':id/reject')
  @Audit('expense.reject')
  @RequirePermission('expense.reject')
  reject(
    @Param('id') id: string,
    @Body() dto: RejectExpenseDto,
    @GetTenant() tenant: TenantContext,
    @Request() req: any,
  ) {
    const tenantId = tenant?.tenantId ?? req.user.tenant_id;
    return this.expensesService.reject(id, dto, tenantId, req.user.sub);
  }

  @Patch(':id/cancel')
  @Audit('expense.cancel')
  @RequirePermission('expense.request')
  cancel(
    @Param('id') id: string,
    @GetTenant() tenant: TenantContext,
    @Request() req: any,
  ) {
    const tenantId = tenant?.tenantId ?? req.user.tenant_id;
    return this.expensesService.cancel(id, tenantId);
  }
}