import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant-context';
import { DocumentsEnabledGuard } from './documents-enabled.guard';
import { AssetsService } from './assets.service';
import {
  AssetPermissionDto,
  CreateAssetDto,
  UpdateAssetDto,
} from './dto/asset.dto';

const FILE_LIMIT = { limits: { fileSize: 5 * 1024 * 1024 } };

// Document Template Builder, Phase 3: private asset library (stamps, signatures, logos, images).
@Controller('documents/assets')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard, DocumentsEnabledGuard)
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  private userId(req: Request): string {
    return (req.user as { sub: string }).sub;
  }

  @Get()
  @RequirePermission('documents.view')
  list(
    @GetTenant() tenant: TenantContext,
    @Query('category') category?: string,
    @Query('status') status?: string,
  ) {
    return this.assets.list(tenant, { category, status });
  }

  @Post()
  @RequirePermission('documents.manage')
  @UseInterceptors(FileInterceptor('file', FILE_LIMIT))
  create(
    @GetTenant() tenant: TenantContext,
    @Req() req: Request,
    @Body() dto: CreateAssetDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.assets.create(tenant, this.userId(req), dto, file);
  }

  @Get(':id')
  @RequirePermission('documents.view')
  get(
    @GetTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.assets.get(tenant, id);
  }

  @Patch(':id')
  @RequirePermission('documents.manage')
  update(
    @GetTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAssetDto,
  ) {
    return this.assets.update(tenant, id, dto);
  }

  @Delete(':id')
  @RequirePermission('documents.manage')
  remove(
    @GetTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.assets.remove(tenant, id);
  }

  @Post(':id/version')
  @RequirePermission('documents.manage')
  @UseInterceptors(FileInterceptor('file', FILE_LIMIT))
  replace(
    @GetTenant() tenant: TenantContext,
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.assets.replaceFile(tenant, this.userId(req), id, file);
  }

  // documents.manage (not view): a stamp/signature image is only fetched by those who manage them.
  @Get(':id/signed-url')
  @RequirePermission('documents.manage')
  signedUrl(
    @GetTenant() tenant: TenantContext,
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.assets.signedUrl(tenant, this.userId(req), id);
  }

  @Get(':id/permissions')
  @RequirePermission('documents.manage')
  permissions(
    @GetTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.assets.permissions(tenant, id);
  }

  @Post(':id/permissions')
  @RequirePermission('documents.manage')
  addPermission(
    @GetTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssetPermissionDto,
  ) {
    return this.assets.addPermission(tenant, id, dto);
  }

  @Delete(':id/permissions/:permissionId')
  @RequirePermission('documents.manage')
  removePermission(
    @GetTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('permissionId', ParseUUIDPipe) permissionId: string,
  ) {
    return this.assets.removePermission(tenant, id, permissionId);
  }
}
