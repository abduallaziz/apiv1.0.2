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
import { ReleasesService } from './releases.service';
import { CreateReleaseDto } from './dto/create-release.dto';
import { UpdateReleaseDto } from './dto/update-release.dto';
import { RejectReleaseDto } from './dto/reject-release.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtPayload } from '../../shared/types/jwt-payload.type';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('purchasing/releases')
export class ReleasesController {
  constructor(private readonly releasesService: ReleasesService) {}

  @Get()
  @RequirePermission('purchasing.view')
  findAll(
    @Query('agreement_id') agreementId: string,
    @Query('status') status: string,
    @GetTenant() tenant: TenantContext,
    @Query('page') page?: string,
    @Query('per_page') perPage?: string,
  ) {
    return this.releasesService.findAll(
      tenant.tenantId,
      agreementId,
      status,
      page,
      perPage,
    );
  }

  @Get(':id')
  @RequirePermission('purchasing.view')
  findOne(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.releasesService.findById(id, tenant.tenantId);
  }

  @Get(':id/history')
  @RequirePermission('purchasing.view')
  history(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.releasesService.history(id, tenant.tenantId);
  }

  @Post()
  @RequirePermission('purchasing.manage')
  create(
    @Body() dto: CreateReleaseDto,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.releasesService.create(tenant.tenantId, dto, user.sub);
  }

  @Patch(':id')
  @RequirePermission('purchasing.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateReleaseDto,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.releasesService.update(id, tenant.tenantId, dto);
  }

  @Post(':id/submit')
  @RequirePermission('purchasing.manage')
  @HttpCode(HttpStatus.OK)
  submit(
    @Param('id') id: string,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.releasesService.submit(id, tenant.tenantId, user.sub);
  }

  @Post(':id/approve')
  @RequirePermission('purchasing.release.approve')
  @HttpCode(HttpStatus.OK)
  approve(
    @Param('id') id: string,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.releasesService.approve(id, tenant.tenantId, user.sub);
  }

  @Post(':id/reject')
  @RequirePermission('purchasing.release.reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @Param('id') id: string,
    @Body() dto: RejectReleaseDto,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.releasesService.reject(id, tenant.tenantId, user.sub, dto);
  }

  @Post(':id/cancel')
  @RequirePermission('purchasing.manage')
  @HttpCode(HttpStatus.OK)
  cancel(
    @Param('id') id: string,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.releasesService.cancel(id, tenant.tenantId, user.sub);
  }

  @Delete(':id')
  @RequirePermission('purchasing.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.releasesService.remove(id, tenant.tenantId);
  }
}
