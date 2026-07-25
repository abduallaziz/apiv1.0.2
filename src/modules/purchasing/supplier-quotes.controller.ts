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
import { SupplierQuotesService } from './supplier-quotes.service';
import { CreateSupplierQuoteDto } from './dto/create-supplier-quote.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtPayload } from '../../shared/types/jwt-payload.type';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('purchasing/supplier-quotes')
export class SupplierQuotesController {
  constructor(private readonly supplierQuotesService: SupplierQuotesService) {}

  @Get()
  @RequirePermission('purchasing.view')
  findAllForRfq(
    @Query('rfq_id') rfqId: string,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.supplierQuotesService.findAllForRfq(rfqId, tenant.tenantId);
  }

  @Get(':id')
  @RequirePermission('purchasing.view')
  findOne(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.supplierQuotesService.findById(id, tenant.tenantId);
  }

  @Post()
  @RequirePermission('purchasing.manage')
  createOrRevise(
    @Body() dto: CreateSupplierQuoteDto,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.supplierQuotesService.createOrRevise(
      tenant.tenantId,
      dto,
      user.sub,
    );
  }

  @Post(':id/submit')
  @RequirePermission('purchasing.manage')
  @HttpCode(HttpStatus.OK)
  submit(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.supplierQuotesService.submit(id, tenant.tenantId);
  }

  @Post(':id/reject')
  @RequirePermission('purchasing.manage')
  @HttpCode(HttpStatus.OK)
  reject(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.supplierQuotesService.reject(id, tenant.tenantId);
  }
}
