import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { OperationsService } from './operations.service';
import { CreateOperationDto } from './dto/create-operation.dto';
import { UpdateOperationDto } from './dto/update-operation.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';

// Migration 13.16A (#16, Manufacturing — Routing). Reuses the existing
// manufacturing.view/manufacturing.manage permissions — no new permission
// created, matching the exact set the approved scope named.
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('manufacturing/production-orders/:id/operations')
export class OperationsController {
  constructor(private readonly operationsService: OperationsService) {}

  @Get()
  @RequirePermission('manufacturing.view')
  findAll(
    @Param('id') productionOrderId: string,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.operationsService.findByProductionOrder(
      productionOrderId,
      tenant.tenantId,
    );
  }

  @Post()
  @RequirePermission('manufacturing.manage')
  create(
    @Param('id') productionOrderId: string,
    @Body() dto: CreateOperationDto,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.operationsService.create(
      productionOrderId,
      tenant.tenantId,
      dto,
    );
  }

  @Patch(':operationId')
  @RequirePermission('manufacturing.manage')
  update(
    @Param('id') productionOrderId: string,
    @Param('operationId') operationId: string,
    @Body() dto: UpdateOperationDto,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.operationsService.update(
      operationId,
      productionOrderId,
      tenant.tenantId,
      dto,
    );
  }
}
