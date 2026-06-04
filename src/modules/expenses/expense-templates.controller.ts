import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';
import { ExpenseTemplatesService } from './expense-templates.service';
import { CreateExpenseTemplateDto } from './dto/create-expense-template.dto';
import { UpdateExpenseTemplateDto } from './dto/update-expense-template.dto';

@Controller('expense-templates')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
export class ExpenseTemplatesController {
  constructor(private readonly templatesService: ExpenseTemplatesService) {}

  @Get()
  findAll(@GetTenant() tenant: TenantContext, @Request() req: any) {
    const tenantId = tenant?.tenantId ?? req.user.tenant_id;
    return this.templatesService.findAll(tenantId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @GetTenant() tenant: TenantContext, @Request() req: any) {
    const tenantId = tenant?.tenantId ?? req.user.tenant_id;
    return this.templatesService.findOne(id, tenantId);
  }

  @Post()
  create(
    @Body() dto: CreateExpenseTemplateDto,
    @GetTenant() tenant: TenantContext,
    @Request() req: any,
  ) {
    const tenantId = tenant?.tenantId ?? req.user.tenant_id;
    return this.templatesService.create(dto, tenantId);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateExpenseTemplateDto,
    @GetTenant() tenant: TenantContext,
    @Request() req: any,
  ) {
    const tenantId = tenant?.tenantId ?? req.user.tenant_id;
    return this.templatesService.update(id, dto, tenantId);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @GetTenant() tenant: TenantContext, @Request() req: any) {
    const tenantId = tenant?.tenantId ?? req.user.tenant_id;
    return this.templatesService.remove(id, tenantId);
  }
}