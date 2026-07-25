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
import { AwardsService } from './awards.service';
import { CreateAwardDto } from './dto/create-award.dto';
import { CreatePoFromAwardDto } from './dto/create-po-from-award.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtPayload } from '../../shared/types/jwt-payload.type';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('purchasing/awards')
export class AwardsController {
  constructor(private readonly awardsService: AwardsService) {}

  @Get()
  @RequirePermission('purchasing.view')
  findAllForRfq(
    @Query('rfq_id') rfqId: string,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.awardsService.findAllForRfq(rfqId, tenant.tenantId);
  }

  @Get(':id')
  @RequirePermission('purchasing.view')
  findOne(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.awardsService.findById(id, tenant.tenantId);
  }

  @Post()
  @RequirePermission('purchasing.manage')
  create(
    @Body() dto: CreateAwardDto,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.awardsService.create(tenant.tenantId, dto, user.sub);
  }

  @Post(':id/confirm')
  @RequirePermission('purchasing.manage')
  @HttpCode(HttpStatus.OK)
  confirm(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.awardsService.confirm(id, tenant.tenantId);
  }

  @Post(':id/cancel')
  @RequirePermission('purchasing.manage')
  @HttpCode(HttpStatus.OK)
  cancel(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.awardsService.cancel(id, tenant.tenantId);
  }

  @Post(':id/create-purchase-orders')
  @RequirePermission('purchasing.manage')
  @HttpCode(HttpStatus.OK)
  createPurchaseOrders(
    @Param('id') id: string,
    @Body() dto: CreatePoFromAwardDto,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.awardsService.createPurchaseOrders(
      id,
      tenant.tenantId,
      dto.warehouse_id,
      dto.order_number_prefix,
      user.sub,
    );
  }
}
