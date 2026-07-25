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
import { RfqsService } from './rfqs.service';
import { CreateRfqDto } from './dto/create-rfq.dto';
import { UpdateRfqDto } from './dto/update-rfq.dto';
import { RejectRfqDto } from './dto/reject-rfq.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtPayload } from '../../shared/types/jwt-payload.type';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('purchasing/rfqs')
export class RfqsController {
  constructor(private readonly rfqsService: RfqsService) {}

  @Get()
  @RequirePermission('purchasing.view')
  findAll(
    @Query('status') status: string,
    @GetTenant() tenant: TenantContext,
    @Query('page') page?: string,
    @Query('per_page') perPage?: string,
  ) {
    return this.rfqsService.findAll(tenant.tenantId, status, page, perPage);
  }

  @Get(':id')
  @RequirePermission('purchasing.view')
  findOne(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.rfqsService.findById(id, tenant.tenantId);
  }

  @Get(':id/history')
  @RequirePermission('purchasing.view')
  history(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.rfqsService.history(id, tenant.tenantId);
  }

  @Post()
  @RequirePermission('purchasing.manage')
  create(
    @Body() dto: CreateRfqDto,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.rfqsService.create(tenant.tenantId, dto, user.sub);
  }

  @Patch(':id')
  @RequirePermission('purchasing.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateRfqDto,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.rfqsService.update(id, tenant.tenantId, dto);
  }

  @Post(':id/submit')
  @RequirePermission('purchasing.manage')
  @HttpCode(HttpStatus.OK)
  submit(
    @Param('id') id: string,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.rfqsService.submit(id, tenant.tenantId, user.sub);
  }

  @Post(':id/approve')
  @RequirePermission('purchasing.rfq.approve')
  @HttpCode(HttpStatus.OK)
  approve(
    @Param('id') id: string,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.rfqsService.approve(id, tenant.tenantId, user.sub);
  }

  @Post(':id/reject')
  @RequirePermission('purchasing.rfq.reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @Param('id') id: string,
    @Body() dto: RejectRfqDto,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.rfqsService.reject(id, tenant.tenantId, user.sub, dto);
  }

  @Post(':id/send')
  @RequirePermission('purchasing.manage')
  @HttpCode(HttpStatus.OK)
  send(
    @Param('id') id: string,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.rfqsService.send(id, tenant.tenantId, user.sub);
  }

  @Post(':id/cancel')
  @RequirePermission('purchasing.manage')
  @HttpCode(HttpStatus.OK)
  cancel(
    @Param('id') id: string,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.rfqsService.cancel(id, tenant.tenantId, user.sub);
  }

  @Delete(':id')
  @RequirePermission('purchasing.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.rfqsService.remove(id, tenant.tenantId);
  }
}
