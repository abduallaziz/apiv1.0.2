import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { GiftCardsService } from './gift-cards.service';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant-context';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { CreateGiftCardDto } from './dto/create-gift-card.dto';
import { UpdateGiftCardDto } from './dto/update-gift-card.dto';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('gift-cards')
export class GiftCardsController {
  constructor(private readonly service: GiftCardsService) {}

  @Get()
  @RequirePermission('gift_cards.manage')
  findAll(@GetTenant() tenant: TenantContext) {
    return this.service.findAll(tenant);
  }

  @Post()
  @RequirePermission('gift_cards.manage')
  create(@GetTenant() tenant: TenantContext, @Body() dto: CreateGiftCardDto) {
    return this.service.create(tenant, dto);
  }

  @Patch(':id')
  @RequirePermission('gift_cards.manage')
  update(
    @GetTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body() dto: UpdateGiftCardDto,
  ) {
    return this.service.update(tenant, id, dto);
  }

  @Delete(':id')
  @RequirePermission('gift_cards.manage')
  remove(@GetTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.service.remove(tenant, id);
  }
}
