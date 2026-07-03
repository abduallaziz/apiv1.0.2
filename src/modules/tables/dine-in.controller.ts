import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  ParseUUIDPipe,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { DineInService } from './dine-in.service';
import { AddDineInItemsDto } from './dto/add-dine-in-items.dto';
import { CheckoutDineInDto } from './dto/checkout-dine-in.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant-context';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('tables/:id')
export class DineInController {
  constructor(private readonly service: DineInService) {}

  @Post('open')
  @RequirePermission('tables.manage')
  open(
    @Param('id', ParseUUIDPipe) id: string,
    @GetTenant() tenant: TenantContext,
    @Req() req: Request,
  ) {
    const user = req.user as { sub: string };
    return this.service.openTable(tenant, id, user.sub);
  }

  @Post('items')
  @RequirePermission('tables.manage')
  addItems(
    @Param('id', ParseUUIDPipe) id: string,
    @GetTenant() tenant: TenantContext,
    @Body() dto: AddDineInItemsDto,
  ) {
    return this.service.addItems(tenant, id, dto);
  }

  @Get('order')
  @RequirePermission('tables.manage')
  getCurrentOrder(@Param('id', ParseUUIDPipe) id: string, @GetTenant() tenant: TenantContext) {
    return this.service.getCurrentOrder(tenant, id);
  }

  @Post('checkout')
  @RequirePermission('tables.manage')
  checkout(
    @Param('id', ParseUUIDPipe) id: string,
    @GetTenant() tenant: TenantContext,
    @Body() dto: CheckoutDineInDto,
    @Req() req: Request,
  ) {
    const user = req.user as { sub: string; role: string };
    const ip = (req.headers['x-forwarded-for'] as string) ?? req.ip ?? '';
    const device = (req.headers['user-agent'] as string) ?? '';
    return this.service.checkout(tenant, id, dto, user.sub, user.role, ip, device);
  }
}
