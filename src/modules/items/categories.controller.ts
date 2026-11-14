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
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';
import { isolatedBranchId } from '../../core/tenant/branch-scope-id.util';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  @RequirePermission('items.view')
  findAll(@GetTenant() tenant: TenantContext, @Query('type') type?: string) {
    return this.categoriesService.findAll(
      tenant.tenantId,
      type,
      isolatedBranchId(tenant),
    );
  }

  @Get(':id')
  @RequirePermission('items.view')
  findOne(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.categoriesService.findById(
      id,
      tenant.tenantId,
      isolatedBranchId(tenant),
    );
  }

  @Post()
  @RequirePermission('items.manage')
  create(@Body() dto: CreateCategoryDto, @GetTenant() tenant: TenantContext) {
    return this.categoriesService.create(
      tenant.tenantId,
      dto,
      isolatedBranchId(tenant),
    );
  }

  @Patch(':id')
  @RequirePermission('items.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.categoriesService.update(
      id,
      tenant.tenantId,
      dto,
      isolatedBranchId(tenant),
    );
  }

  @Delete(':id')
  @RequirePermission('items.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.categoriesService.remove(
      id,
      tenant.tenantId,
      isolatedBranchId(tenant),
    );
  }
}
