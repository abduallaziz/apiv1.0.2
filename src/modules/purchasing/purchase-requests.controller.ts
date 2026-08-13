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
import { PurchaseRequestsService } from './purchase-requests.service';
import { CreatePurchaseRequestDto } from './dto/create-purchase-request.dto';
import { UpdatePurchaseRequestDto } from './dto/update-purchase-request.dto';
import { RejectPurchaseRequestDto } from './dto/reject-purchase-request.dto';
import { ConvertSuggestionsDto } from './dto/convert-suggestions.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtPayload } from '../../shared/types/jwt-payload.type';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('purchasing/purchase-requests')
export class PurchaseRequestsController {
  constructor(
    private readonly purchaseRequestsService: PurchaseRequestsService,
  ) {}

  @Get()
  @RequirePermission('purchasing.view')
  findAll(
    @Query('status') status: string,
    @GetTenant() tenant: TenantContext,
    @Query('page') page?: string,
    @Query('per_page') perPage?: string,
  ) {
    return this.purchaseRequestsService.findAll(
      tenant.tenantId,
      status,
      page,
      perPage,
    );
  }

  @Get(':id')
  @RequirePermission('purchasing.view')
  findOne(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.purchaseRequestsService.findById(id, tenant.tenantId);
  }

  @Get(':id/history')
  @RequirePermission('purchasing.view')
  history(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.purchaseRequestsService.history(id, tenant.tenantId);
  }

  @Post()
  @RequirePermission('purchasing.manage')
  create(
    @Body() dto: CreatePurchaseRequestDto,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.purchaseRequestsService.create(tenant.tenantId, dto, user.sub);
  }

  @Post('from-suggestions')
  @RequirePermission('purchasing.manage')
  createFromSuggestions(
    @Body() dto: ConvertSuggestionsDto,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.purchaseRequestsService.createFromSuggestions(
      tenant.tenantId,
      dto,
      user.sub,
    );
  }

  @Patch(':id')
  @RequirePermission('purchasing.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePurchaseRequestDto,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.purchaseRequestsService.update(id, tenant.tenantId, dto);
  }

  @Post(':id/submit')
  @RequirePermission('purchasing.manage')
  @HttpCode(HttpStatus.OK)
  submit(
    @Param('id') id: string,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.purchaseRequestsService.submit(id, tenant.tenantId, user.sub);
  }

  @Post(':id/approve')
  @RequirePermission('purchasing.pr.approve')
  @HttpCode(HttpStatus.OK)
  approve(
    @Param('id') id: string,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.purchaseRequestsService.approve(id, tenant.tenantId, user.sub);
  }

  @Post(':id/reject')
  @RequirePermission('purchasing.pr.reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @Param('id') id: string,
    @Body() dto: RejectPurchaseRequestDto,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.purchaseRequestsService.reject(
      id,
      tenant.tenantId,
      user.sub,
      dto,
    );
  }

  @Post(':id/cancel')
  @RequirePermission('purchasing.manage')
  @HttpCode(HttpStatus.OK)
  cancel(
    @Param('id') id: string,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.purchaseRequestsService.cancel(id, tenant.tenantId, user.sub);
  }

  @Delete(':id')
  @RequirePermission('purchasing.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.purchaseRequestsService.remove(id, tenant.tenantId);
  }
}
