import {
  Body,
  Controller,
  Logger,
  ServiceUnavailableException,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ConfigService } from '@nestjs/config';
import { buildZatcaQrBase64 } from '../print/zatca-qr.util';
import { QR_KINDS, minQrSizeMm } from './qr.util';
import { StreamableFile } from '@nestjs/common';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant-context';
import { DocumentsEnabledGuard } from './documents-enabled.guard';
import { TemplatesService } from './templates.service';
import { DefaultTemplateService } from './default-template.service';
import { AssetsService } from './assets.service';
import { TemplateRenderService } from './template-render.service';
import type { RenderBody } from './template-render.service';
import { sampleData } from './render-sample-data';
import { sanitizeBody } from './template-body.util';
import { BINDINGS, ITEM_COLUMNS } from './bindings.catalog';
import { PdfRendererService } from '../shifts/report/pdf-renderer.service';
import {
  AssignTemplateDto,
  CreateTemplateDto,
  PreviewDto,
  UpdateTemplateDto,
} from './dto/template.dto';

// Document Template Builder (docs/DESIGN_DOCUMENT_BUILDER.md). Phase 2: template management.
// Everything is gated by DOCUMENTS_BUILDER_ENABLED and documents.view / documents.manage.
@Controller('documents/templates')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard, DocumentsEnabledGuard)
export class DocumentsController {
  private readonly logger = new Logger(DocumentsController.name);

  constructor(
    private readonly templates: TemplatesService,
    private readonly defaults: DefaultTemplateService,
    private readonly assets: AssetsService,
    private readonly renderer: TemplateRenderService,
    private readonly pdf: PdfRendererService,
    private readonly config: ConfigService,
  ) {}

  // QR contents for previews: fictional, but built by the same code paths as real documents.
  private sampleQr() {
    const base = (
      this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000'
    ).replace(/\/+$/, '');
    return {
      verificationUrl: `${base}/ar/public/verify/SAMPLE-PREVIEW-TOKEN-0000000000`,
      zatca: buildZatcaQrBase64({
        sellerName: 'Sample Company Co.',
        vatNumber: '300000000000003',
        timestamp: '2026-01-15T10:00:00Z',
        totalWithVat: 460,
        vatAmount: 60,
      }),
      payment: 'SA0000000000000000000000',
    };
  }

  // Renders the template's working draft with FICTIONAL sample data (never tenant data).
  private async renderSample(
    tenant: TenantContext,
    id: string,
    lang?: string,
    over?: Pick<PreviewDto, 'body' | 'paper' | 'orientation' | 'overlays'>,
  ): Promise<{
    html: string;
    assetUrls: Record<string, string>;
    warnings: string[];
  }> {
    const t = (await this.templates.get(tenant, id)) as unknown as {
      paper: string;
      orientation: string;
      body: Record<string, unknown> | null;
    };
    const body = (
      over?.body ? sanitizeBody(over.body) : (t.body ?? {})
    ) as RenderBody;
    const assetIds = (body.elements ?? [])
      .map((e) => e.assetId)
      .filter((a): a is string => typeof a === 'string');
    const assetUrls = await this.assets.signedUrlsFor(tenant, assetIds);
    const warnings: string[] = [];
    const html = this.renderer.render({
      body,
      paper: over?.paper ?? t.paper,
      orientation: over?.orientation ?? t.orientation,
      direction: lang === 'en' ? 'ltr' : 'rtl',
      data: sampleData(lang === 'en' ? 'en' : 'ar'),
      assetUrls,
      omitOverlays: over?.overlays === false,
      qr: this.sampleQr(),
      warnings,
    });
    return { html, assetUrls, warnings };
  }

  @Get(':id/preview')
  @RequirePermission('documents.manage')
  async preview(
    @GetTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('lang') lang?: string,
  ) {
    return this.renderSample(tenant, id, lang);
  }

  // Same renderer, but for the editor's UNSAVED draft (never persisted by this call).
  @Post(':id/preview')
  @RequirePermission('documents.manage')
  async previewDraft(
    @GetTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PreviewDto,
  ) {
    return this.renderSample(tenant, id, dto.lang, dto);
  }

  @Get(':id/pdf')
  @RequirePermission('documents.manage')
  async pdfPreview(
    @GetTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('lang') lang?: string,
  ) {
    const { html } = await this.renderSample(tenant, id, lang);
    let buffer: Buffer;
    try {
      buffer = await this.pdf.renderDocument(html);
    } catch (e) {
      // The PDF engine (headless Chrome) can fail or time out on its own; that is an
      // engine-availability problem, not an opaque server bug: answer 503 and log the cause.
      if (e instanceof ServiceUnavailableException) throw e;
      this.logger.error(
        `Template test print failed (${id}): ${e instanceof Error ? e.message : String(e)}`,
      );
      throw new ServiceUnavailableException('PDF rendering failed');
    }
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: 'inline; filename="template-preview.pdf"',
    });
  }

  private userId(req: Request): string {
    return (req.user as { sub: string }).sub;
  }

  // The whitelist of fields a template may bind to (drives the editor's field picker).
  @Get('bindings')
  @RequirePermission('documents.view')
  bindings() {
    return {
      bindings: BINDINGS,
      itemColumns: ITEM_COLUMNS,
      // smallest scannable QR side (mm) per kind; custom URLs are sized from their own length
      qrMinSizeMm: Object.fromEntries(
        QR_KINDS.filter((k) => k !== 'custom_url').map((k) => [
          k,
          minQrSizeMm(k),
        ]),
      ),
    };
  }

  @Get()
  @RequirePermission('documents.view')
  async list(
    @GetTenant() tenant: TenantContext,
    @Req() req: Request,
    @Query('docType') docType?: string,
    @Query('status') status?: string,
  ) {
    // first visit: the tenant gets the ready-made quotation templates (Arabic + English)
    await this.defaults.ensure(tenant, this.userId(req));
    return this.templates.list(tenant, { docType, status });
  }

  // Re-creates the ready-made quotation templates (Arabic + English) for a tenant that has
  // none left (e.g. it deleted them). Does nothing when the tenant already has a template.
  @Post('defaults')
  @RequirePermission('documents.manage')
  async restoreDefaults(
    @GetTenant() tenant: TenantContext,
    @Req() req: Request,
  ) {
    const created = await this.defaults.restore(tenant, this.userId(req));
    return { created };
  }

  @Post()
  @RequirePermission('documents.manage')
  create(
    @GetTenant() tenant: TenantContext,
    @Req() req: Request,
    @Body() dto: CreateTemplateDto,
  ) {
    return this.templates.create(tenant, this.userId(req), dto);
  }

  @Get(':id')
  @RequirePermission('documents.view')
  get(
    @GetTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.templates.get(tenant, id);
  }

  @Patch(':id')
  @RequirePermission('documents.manage')
  update(
    @GetTenant() tenant: TenantContext,
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTemplateDto,
  ) {
    return this.templates.update(tenant, this.userId(req), id, dto);
  }

  @Delete(':id')
  @RequirePermission('documents.manage')
  remove(
    @GetTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.templates.remove(tenant, id);
  }

  @Post(':id/duplicate')
  @RequirePermission('documents.manage')
  duplicate(
    @GetTenant() tenant: TenantContext,
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.templates.duplicate(tenant, this.userId(req), id);
  }

  @Post(':id/publish')
  @RequirePermission('documents.manage')
  publish(
    @GetTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.templates.publish(tenant, id);
  }

  @Post(':id/archive')
  @RequirePermission('documents.manage')
  archive(
    @GetTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.templates.archive(tenant, id);
  }

  @Post(':id/default')
  @RequirePermission('documents.manage')
  setDefault(
    @GetTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.templates.setDefault(tenant, id);
  }

  @Get(':id/versions')
  @RequirePermission('documents.view')
  versions(
    @GetTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.templates.versions(tenant, id);
  }

  @Post(':id/versions/:version/restore')
  @RequirePermission('documents.manage')
  restore(
    @GetTenant() tenant: TenantContext,
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('version', ParseIntPipe) version: number,
  ) {
    return this.templates.restoreVersion(tenant, this.userId(req), id, version);
  }

  @Get(':id/assignments')
  @RequirePermission('documents.view')
  assignments(
    @GetTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.templates.assignments(tenant, id);
  }

  @Post(':id/assignments')
  @RequirePermission('documents.manage')
  assign(
    @GetTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignTemplateDto,
  ) {
    return this.templates.assign(tenant, id, dto);
  }
}
