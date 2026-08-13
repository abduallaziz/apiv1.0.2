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
import { CorrectiveActionsService } from './corrective-actions.service';
import { CreateCorrectiveActionDto } from './dto/create-corrective-action.dto';
import { CompleteCorrectiveActionDto } from './dto/complete-corrective-action.dto';
import { VerifyCorrectiveActionDto } from './dto/verify-corrective-action.dto';
import { CloseCorrectiveActionDto } from './dto/close-corrective-action.dto';
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
@Controller('quality/corrective-actions')
export class CorrectiveActionsController {
  constructor(private readonly capaService: CorrectiveActionsService) {}

  @Get()
  @RequirePermission('quality.view')
  findAll(
    @GetTenant() tenant: TenantContext,
    @Query('owner_id') ownerId?: string,
    @Query('status') status?: string,
  ) {
    return this.capaService.findAll(tenant.tenantId, ownerId, status);
  }

  @Get(':id')
  @RequirePermission('quality.view')
  findOne(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.capaService.findById(id, tenant.tenantId);
  }

  @Get(':id/history')
  @RequirePermission('quality.view')
  history(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.capaService.history(id, tenant.tenantId);
  }

  @Post()
  @RequirePermission('quality.manage')
  @Audit('corrective_action.created')
  create(
    @Body() dto: CreateCorrectiveActionDto,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.capaService.create(tenant.tenantId, dto, user.sub);
  }

  @Post(':id/start')
  @RequirePermission('quality.execute')
  @HttpCode(HttpStatus.OK)
  start(
    @Param('id') id: string,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.capaService.start(id, tenant.tenantId, user.sub);
  }

  @Post(':id/complete')
  @RequirePermission('quality.execute')
  @HttpCode(HttpStatus.OK)
  @Audit('corrective_action.completed')
  complete(
    @Param('id') id: string,
    @Body() dto: CompleteCorrectiveActionDto,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.capaService.complete(id, tenant.tenantId, dto, user.sub);
  }

  @Post(':id/verify')
  @RequirePermission('quality.approve')
  @HttpCode(HttpStatus.OK)
  @Audit('corrective_action.verified')
  verify(
    @Param('id') id: string,
    @Body() dto: VerifyCorrectiveActionDto,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.capaService.verify(id, tenant.tenantId, dto, user.sub);
  }

  @Post(':id/close')
  @RequirePermission('quality.approve')
  @HttpCode(HttpStatus.OK)
  @Audit('corrective_action.closed')
  close(
    @Param('id') id: string,
    @Body() dto: CloseCorrectiveActionDto,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.capaService.close(id, tenant.tenantId, dto, user.sub);
  }
}
