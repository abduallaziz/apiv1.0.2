import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { OutputsService } from './outputs.service';
import { CreateOutputDto } from './dto/create-output.dto';
import { UpdateOutputDto } from './dto/update-output.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';

// Migration 13.16B (#16, Manufacturing — By-products). Planning a
// by-product output is the same category of action as BOM/routing setup,
// so this reuses manufacturing.manage for writes (not a new permission) —
// actual receipt into stock happens automatically at completion time
// (ProductionOrdersService.complete()), not through a route here.
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('manufacturing/production-orders/:id/outputs')
export class OutputsController {
  constructor(private readonly outputsService: OutputsService) {}

  @Get()
  @RequirePermission('manufacturing.view')
  findAll(
    @Param('id') productionOrderId: string,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.outputsService.findByProductionOrder(
      productionOrderId,
      tenant.tenantId,
    );
  }

  @Post()
  @RequirePermission('manufacturing.manage')
  create(
    @Param('id') productionOrderId: string,
    @Body() dto: CreateOutputDto,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.outputsService.create(productionOrderId, tenant.tenantId, dto);
  }

  @Patch(':outputId')
  @RequirePermission('manufacturing.manage')
  update(
    @Param('id') productionOrderId: string,
    @Param('outputId') outputId: string,
    @Body() dto: UpdateOutputDto,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.outputsService.update(
      outputId,
      productionOrderId,
      tenant.tenantId,
      dto,
    );
  }
}
