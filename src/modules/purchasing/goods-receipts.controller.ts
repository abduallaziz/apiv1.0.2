import { Controller, Get, Post, Param, Body, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { GoodsReceiptsService } from './goods-receipts.service';
import { CreateGoodsReceiptDto } from './dto/create-goods-receipt.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtPayload } from '../../shared/types/jwt-payload.type';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('purchasing/goods-receipts')
export class GoodsReceiptsController {
  constructor(private readonly goodsReceiptsService: GoodsReceiptsService) {}

  @Get()
  @RequirePermission('purchasing.view')
  findAll(
    @Query('status') status: string,
    @GetTenant() tenant: TenantContext,
    @Query('page') page?: string,
    @Query('per_page') perPage?: string,
  ) {
    return this.goodsReceiptsService.findAll(tenant.tenantId, status, page, perPage);
  }

  @Get(':id')
  @RequirePermission('purchasing.view')
  findOne(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.goodsReceiptsService.findById(id, tenant.tenantId);
  }

  @Post()
  @RequirePermission('purchasing.receive')
  create(@Body() dto: CreateGoodsReceiptDto, @GetTenant() tenant: TenantContext) {
    return this.goodsReceiptsService.create(tenant.tenantId, dto);
  }

  @Post(':id/post')
  @RequirePermission('purchasing.receive')
  @HttpCode(HttpStatus.OK)
  post(
    @Param('id') id: string,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.goodsReceiptsService.post(id, tenant.tenantId, user.sub);
  }

  @Post(':id/cancel')
  @RequirePermission('purchasing.receive')
  @HttpCode(HttpStatus.OK)
  cancel(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.goodsReceiptsService.cancel(id, tenant.tenantId);
  }
}
