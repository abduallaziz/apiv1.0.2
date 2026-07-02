import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { BranchesService } from './branches.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant-context';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('branches')
export class BranchesController {
  constructor(private readonly service: BranchesService) {}

  @Get()
  @RequirePermission('branches.view')
  findAll(@GetTenant() tenant: TenantContext) {
    return this.service.findAll(tenant);
  }

  @Get(':id')
  @RequirePermission('branches.view')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.service.findById(id, tenant);
  }

  @Post()
  @RequirePermission('branches.manage')
  create(
    @Body() dto: CreateBranchDto,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.service.create(dto, tenant);
  }

  @Patch(':id')
  @RequirePermission('branches.manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBranchDto,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.service.update(id, dto, tenant);
  }

  @Delete(':id')
  @RequirePermission('branches.manage')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.service.remove(id, tenant);
  }
}