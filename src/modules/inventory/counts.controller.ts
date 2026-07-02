import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { CountsService } from './counts.service';
import { CreateStockCountDto } from './dto/create-stock-count.dto';
import { SubmitCountItemDto } from './dto/submit-count-item.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtPayload } from '../../shared/types/jwt-payload.type';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('inventory/counts')
export class CountsController {
  constructor(private readonly countsService: CountsService) {}

  @Get()
  @RequirePermission('inventory.view')
  findAll(
    @Query('status') status: string,
    @GetTenant() tenant: TenantContext,
    @Query('page') page?: string,
    @Query('per_page') perPage?: string,
  ) {
    return this.countsService.findAll(tenant.tenantId, status, page, perPage);
  }

  @Get(':id')
  @RequirePermission('inventory.view')
  findOne(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.countsService.findById(id, tenant.tenantId);
  }

  @Post()
  @RequirePermission('inventory.count')
  create(
    @Body() dto: CreateStockCountDto,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.countsService.create(tenant.tenantId, dto, user.sub);
  }

  @Patch(':id/items/:itemId')
  @RequirePermission('inventory.count')
  submitCount(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: SubmitCountItemDto,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.countsService.submitCount(id, itemId, tenant.tenantId, dto);
  }

  @Post(':id/finalize')
  @RequirePermission('inventory.count')
  @HttpCode(HttpStatus.OK)
  finalize(
    @Param('id') id: string,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.countsService.finalize(id, tenant.tenantId, user.sub);
  }
}
