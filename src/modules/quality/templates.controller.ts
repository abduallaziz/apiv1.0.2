import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { QualityConfigService } from './quality-config.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';
import { Audit } from '../../core/audit/audit.decorator';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('quality/templates')
export class TemplatesController {
  constructor(private readonly configService: QualityConfigService) {}

  @Get()
  @RequirePermission('quality.view')
  findAll(@GetTenant() tenant: TenantContext) {
    return this.configService.findAllTemplates(tenant.tenantId);
  }

  @Get(':id')
  @RequirePermission('quality.view')
  findOne(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.configService.findTemplateById(id, tenant.tenantId);
  }

  @Post()
  @RequirePermission('quality.manage')
  @Audit('quality_template.created')
  create(@Body() dto: CreateTemplateDto, @GetTenant() tenant: TenantContext) {
    return this.configService.createTemplate(tenant.tenantId, dto);
  }

  @Patch(':id')
  @RequirePermission('quality.manage')
  @HttpCode(HttpStatus.OK)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTemplateDto,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.configService.updateTemplate(id, tenant.tenantId, dto);
  }
}
