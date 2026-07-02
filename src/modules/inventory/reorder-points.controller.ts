import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ReorderPointsService } from './reorder-points.service';
import { CreateReorderPointDto } from './dto/create-reorder-point.dto';
import { UpdateReorderPointDto } from './dto/update-reorder-point.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('inventory/reorder-points')
export class ReorderPointsController {
  constructor(private readonly reorderPointsService: ReorderPointsService) {}

  @Get()
  @RequirePermission('inventory.view')
  findAll(@Query('warehouse_id') warehouseId: string, @GetTenant() tenant: TenantContext) {
    return this.reorderPointsService.findAll(tenant.tenantId, warehouseId);
  }

  @Get('below-minimum')
  @RequirePermission('inventory.view')
  belowMinimum(@GetTenant() tenant: TenantContext) {
    return this.reorderPointsService.belowMinimum(tenant.tenantId);
  }

  @Get(':id')
  @RequirePermission('inventory.view')
  findOne(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.reorderPointsService.findById(id, tenant.tenantId);
  }

  @Post()
  @RequirePermission('inventory.manage')
  create(@Body() dto: CreateReorderPointDto, @GetTenant() tenant: TenantContext) {
    return this.reorderPointsService.create(tenant.tenantId, dto);
  }

  @Patch(':id')
  @RequirePermission('inventory.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateReorderPointDto,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.reorderPointsService.update(id, tenant.tenantId, dto);
  }

  @Delete(':id')
  @RequirePermission('inventory.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.reorderPointsService.remove(id, tenant.tenantId);
  }
}
