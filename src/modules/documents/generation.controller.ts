import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant-context';
import { DocumentsEnabledGuard } from './documents-enabled.guard';
import { GenerationService, type Actor } from './generation.service';
import {
  CreateApprovalDto,
  IssueDocumentDto,
  VoidDocumentDto,
} from './dto/generation.dto';

// Document Template Builder, Phase 10: issuing documents (immutable snapshots + PDF) and the
// approval trail required before a stamp / signature may be used on one.
@Controller('documents')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard, DocumentsEnabledGuard)
export class GenerationController {
  constructor(private readonly generation: GenerationService) {}

  private actor(req: Request): Actor {
    const u = req.user as { sub: string; role?: string; roles?: string[] };
    return {
      userId: u.sub,
      roles: Array.isArray(u.roles) ? u.roles : u.role ? [u.role] : [],
    };
  }

  @Post('generated/issue')
  @RequirePermission('documents.manage')
  issue(
    @GetTenant() tenant: TenantContext,
    @Req() req: Request,
    @Body() dto: IssueDocumentDto,
  ) {
    return this.generation.issue(tenant, this.actor(req), dto);
  }

  @Get('generated')
  @RequirePermission('documents.view')
  list(
    @GetTenant() tenant: TenantContext,
    @Query('docType') docType?: string,
    @Query('sourceRef') sourceRef?: string,
    @Query('limit') limit?: string,
  ) {
    return this.generation.list(tenant, {
      docType,
      sourceRef,
      limit: limit ? Number(limit) || undefined : undefined,
    });
  }

  @Get('generated/:id')
  @RequirePermission('documents.view')
  get(
    @GetTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.generation.get(tenant, id);
  }

  @Get('generated/:id/html')
  @RequirePermission('documents.view')
  html(
    @GetTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.generation.html(tenant, id);
  }

  // Download is the delivery mechanism: the user saves the PDF and sends it themselves.
  @Get('generated/:id/pdf')
  @RequirePermission('documents.view')
  async pdf(
    @GetTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const { bytes, name } = await this.generation.pdfBytes(tenant, id);
    return new StreamableFile(bytes, {
      type: 'application/pdf',
      disposition: `attachment; filename="${name}"`,
    });
  }

  @Post('generated/:id/void')
  @RequirePermission('documents.approve')
  voidDocument(
    @GetTenant() tenant: TenantContext,
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoidDocumentDto,
  ) {
    return this.generation.voidDocument(tenant, this.actor(req), id, dto);
  }

  @Post('approvals')
  @RequirePermission('documents.approve')
  approve(
    @GetTenant() tenant: TenantContext,
    @Req() req: Request,
    @Body() dto: CreateApprovalDto,
  ) {
    return this.generation.createApproval(tenant, this.actor(req), dto);
  }

  @Get('approvals')
  @RequirePermission('documents.view')
  approvals(
    @GetTenant() tenant: TenantContext,
    @Query('docType') docType?: string,
    @Query('templateId') templateId?: string,
  ) {
    const validId =
      templateId && /^[0-9a-f-]{36}$/i.test(templateId)
        ? templateId
        : undefined;
    return this.generation.listApprovals(tenant, {
      docType,
      templateId: validId,
    });
  }
}
