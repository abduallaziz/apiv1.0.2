import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { SuperAdminGuard } from './guards/superadmin.guard';
import { SuperAdminService } from './superadmin.service';
import { SuperAdminTenantsQueryDto } from './dto/superadmin-query.dto';
import { FeatureOverrideDto } from './dto/superadmin-feature-override.dto';
import { ExtendTrialDto } from './dto/superadmin-extend-trial.dto';

@Controller('superadmin')
@UseGuards(JwtAuthGuard, SuperAdminGuard)
export class SuperAdminController {
  constructor(private readonly superAdminService: SuperAdminService) {}

  @Get('stats')
  getStats() {
    return this.superAdminService.getStats();
  }

  @Get('reports/revenue')
  getRevenueReport(@Query('period') period: string = 'month') {
    return this.superAdminService.getRevenueReport(period);
  }


  @Get('features')
getAllFeatures() {
  return this.superAdminService.getAllFeatures();
}

  @Get('tenants')
  findAll(@Query() query: SuperAdminTenantsQueryDto) {
    return this.superAdminService.findAll(query);
  }

  @Get('tenants/:id')
  findOne(@Param('id') id: string) {
    return this.superAdminService.findOne(id);
  }

  @Patch('tenants/:id/activate')
  activate(@Param('id') id: string, @Req() req: Request) {
    return this.superAdminService.activate(id, (req as any).user.sub);
  }

  @Patch('tenants/:id/deactivate')
  deactivate(@Param('id') id: string, @Req() req: Request) {
    return this.superAdminService.deactivate(id, (req as any).user.sub);
  }

  @Patch('tenants/:id/extend-trial')
  extendTrial(
    @Param('id') id: string,
    @Body() dto: ExtendTrialDto,
    @Req() req: Request,
  ) {
    return this.superAdminService.extendTrial(id, dto, (req as any).user.sub);
  }

  @Delete('tenants/:id')
  softDelete(@Param('id') id: string, @Req() req: Request) {
    return this.superAdminService.softDelete(id, (req as any).user.sub);
  }

  // H-028 FIX: aggregated features + overrides endpoint
  @Get('tenants/:id/features')
  getTenantFeatures(@Param('id') id: string) {
    return this.superAdminService.getTenantFeaturesWithOverrides(id);
  }

  @Get('tenants/:id/feature-overrides')
  getFeatureOverrides(@Param('id') id: string) {
    return this.superAdminService.getFeatureOverrides(id);
  }

  @Patch('tenants/:id/features/:featureKey')
  upsertFeatureOverride(
    @Param('id') id: string,
    @Param('featureKey') featureKey: string,
    @Body() dto: FeatureOverrideDto,
    @Req() req: Request,
  ) {
    return this.superAdminService.upsertFeatureOverride(
      id,
      featureKey,
      dto.is_enabled ?? null,
      dto.limit_value ?? null,
      (req as any).user.sub,
      dto.note,
    );
  }

  @Patch('tenants/:id/feature-overrides/:featureKey')
  upsertFeatureOverrideLegacy(
    @Param('id') id: string,
    @Param('featureKey') featureKey: string,
    @Body() dto: FeatureOverrideDto,
    @Req() req: Request,
  ) {
    return this.superAdminService.upsertFeatureOverride(
      id,
      featureKey,
      dto.is_enabled ?? null,
      dto.limit_value ?? null,
      (req as any).user.sub,
      dto.note,
    );
  }
}