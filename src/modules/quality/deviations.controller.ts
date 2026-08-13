import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { DeviationsService } from './deviations.service';
import { CreateDeviationDto } from './dto/create-deviation.dto';
import { DecideDeviationDto } from './dto/decide-deviation.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtPayload } from '../../shared/types/jwt-payload.type';
import { Audit } from '../../core/audit/audit.decorator';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('quality/deviations')
export class DeviationsController {
  constructor(private readonly deviationsService: DeviationsService) {}

  @Get()
  @RequirePermission('quality.view')
  findAll(@GetTenant() tenant: TenantContext) {
    return this.deviationsService.findAll(tenant.tenantId);
  }

  @Get(':id')
  @RequirePermission('quality.view')
  findOne(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.deviationsService.findById(id, tenant.tenantId);
  }

  @Post()
  @RequirePermission('quality.execute')
  @Audit('quality_deviation.created')
  create(
    @Body() dto: CreateDeviationDto,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.deviationsService.create(tenant.tenantId, dto, user.sub);
  }

  @Post(':id/decide')
  @RequirePermission('quality.approve')
  @HttpCode(HttpStatus.OK)
  @Audit('quality_deviation.decided')
  decide(
    @Param('id') id: string,
    @Body() dto: DecideDeviationDto,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.deviationsService.decide(id, tenant.tenantId, dto, user.sub);
  }
}
