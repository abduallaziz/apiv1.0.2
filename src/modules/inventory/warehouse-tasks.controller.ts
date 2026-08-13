import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { WarehouseTasksService } from './warehouse-tasks.service';
import { CreateWarehouseTaskDto } from './dto/create-warehouse-task.dto';
import { AssignWarehouseTaskDto } from './dto/assign-warehouse-task.dto';
import { ConfirmWarehouseTaskDto } from './dto/confirm-warehouse-task.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtPayload } from '../../shared/types/jwt-payload.type';
import { Audit } from '../../core/audit/audit.decorator';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('inventory/warehouse-tasks')
export class WarehouseTasksController {
  constructor(private readonly tasksService: WarehouseTasksService) {}

  @Get()
  @RequirePermission('inventory.view')
  findAll(
    @GetTenant() tenant: TenantContext,
    @Query('task_type') taskType?: string,
    @Query('status') status?: string,
    @Query('assigned_to') assignedTo?: string,
  ) {
    return this.tasksService.findAll(
      tenant.tenantId,
      taskType,
      status,
      assignedTo,
    );
  }

  @Get(':id')
  @RequirePermission('inventory.view')
  findOne(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.tasksService.findById(id, tenant.tenantId);
  }

  @Get(':id/history')
  @RequirePermission('inventory.view')
  history(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.tasksService.history(id, tenant.tenantId);
  }

  @Post()
  @RequirePermission('warehouse.manage')
  @Audit('warehouse_task.created')
  create(
    @Body() dto: CreateWarehouseTaskDto,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.tasksService.create(tenant.tenantId, dto, user.sub);
  }

  @Post(':id/assign')
  @RequirePermission('warehouse.manage')
  @HttpCode(HttpStatus.OK)
  @Audit('warehouse_task.assigned')
  assign(
    @Param('id') id: string,
    @Body() dto: AssignWarehouseTaskDto,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.tasksService.assign(
      id,
      tenant.tenantId,
      dto.assigned_to,
      user.sub,
    );
  }

  @Post(':id/confirm')
  @RequirePermission('warehouse.approve')
  @HttpCode(HttpStatus.OK)
  @Audit('warehouse_task.confirmed')
  confirm(
    @Param('id') id: string,
    @Body() dto: ConfirmWarehouseTaskDto,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.tasksService.confirm(
      id,
      tenant.tenantId,
      dto.quantity,
      dto.confirmed_location_id,
      user.sub,
    );
  }

  @Post(':id/cancel')
  @RequirePermission('warehouse.manage')
  @HttpCode(HttpStatus.OK)
  cancel(
    @Param('id') id: string,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.tasksService.cancel(id, tenant.tenantId, user.sub);
  }
}
