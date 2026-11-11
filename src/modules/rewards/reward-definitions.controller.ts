import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { RewardDefinitionsService } from './reward-definitions.service';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant-context';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { CreateRewardDefinitionDto } from './dto/create-reward-definition.dto';
import { UpdateRewardDefinitionDto } from './dto/update-reward-definition.dto';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('reward-definitions')
export class RewardDefinitionsController {
  constructor(private readonly service: RewardDefinitionsService) {}

  @Get()
  @RequirePermission('rewards.manage')
  findAll(@GetTenant() tenant: TenantContext) {
    return this.service.findAll(tenant);
  }

  @Get(':id')
  @RequirePermission('rewards.manage')
  findOne(@GetTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.service.findOne(tenant, id);
  }

  @Post()
  @RequirePermission('rewards.manage')
  create(
    @GetTenant() tenant: TenantContext,
    @Body() dto: CreateRewardDefinitionDto,
  ) {
    return this.service.create(tenant, dto);
  }

  @Patch(':id')
  @RequirePermission('rewards.manage')
  update(
    @GetTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body() dto: UpdateRewardDefinitionDto,
  ) {
    return this.service.update(tenant, id, dto);
  }

  @Delete(':id')
  @RequirePermission('rewards.manage')
  remove(@GetTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.service.remove(tenant, id);
  }
}
