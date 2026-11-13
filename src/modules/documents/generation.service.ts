import { createHash, randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PoolClient } from 'pg';
import { TenantContext } from '../../core/tenant/tenant-context';
import { TenantSessionService } from '../../core/tenant/tenant-session.service';
import { AuditService } from '../../core/audit/audit.service';
import { StorageService } from '../../shared/storage/storage.service';
import { PdfRendererService } from '../shifts/report/pdf-renderer.service';
import { buildZatcaQrBase64 } from '../print/zatca-qr.util';
import { TemplateRenderService } from './template-render.service';
import type { RenderBody } from './template-render.service';
import {
  VerificationService,
  newVerificationToken,
} from './verification.service';
import {
  ORDER_DOC_TYPES,
  resolveManual,
  resolveOrder,
  type Lang,
  type ResolvedDocument,
} from './document-sources';
import { referencedAssetIds } from './template-body.util';
import { SENSITIVE_ASSET_CATEGORIES } from './dto/asset.dto';
import type {
  CreateApprovalDto,
  IssueDocumentDto,
  VoidDocumentDto,
} from './dto/generation.dto';

export interface Actor {
  userId: string;
  /** Role NAMES from the JWT (asset permissions reference role ids; resolved per request). */
  roles: string[];
}

interface Published {
  templateId: string;
  versionId: string;
  versionCreatedAt: Date;
  paper: string;
  orientation: string;
  body: RenderBody & Record<string, unknown>;
}

interface AssetRow {
  id: string;
  category: string;
  storage_path: string;
  mime: string;
  checksum: string | null;
  status: string;
}

const MAX_ASSET_BYTES = 5 * 1024 * 1024;
type Row = Record<string, unknown>;

// Issuing documents (Phase 10). Rules enforced here, server-side, at issue time (never in the editor):
//  - only a PUBLISHED template version can be used;
//  - a template that places a stamp / signature needs an APPROVED decision made after its current
//    version was published, and the issuer must be allowed to use each such asset;
//  - what is stored is an immutable snapshot (self-contained HTML with the images embedded, the
//    resolved data, the asset references and the PDF); editing a template or replacing an asset
//    later never changes an issued document (the database also refuses such updates).
@Injectable()
export class GenerationService {
  constructor(
    private readonly tenantSession: TenantSessionService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly renderer: TemplateRenderService,
    private readonly pdf: PdfRendererService,
    private readonly verification: VerificationService,
    private readonly config: ConfigService,
  ) {}

  private tid(tenant: TenantContext): string {
    if (!tenant.tenantId)
      throw new BadRequestException('Tenant context missing');
    return tenant.tenantId;
  }

  // ------------------------------------------------------------------ template resolution

  private async loadPublished(
    client: PoolClient,
    tenantId: string,
    templateId: string,
  ): Promise<Published & { docType: string }> {
    const r = await client.query<{
      id: string;
      doc_type: string;
      paper: string;
      orientation: string;
      vid: string;
      vcreated: Date;
      body: RenderBody & Record<string, unknown>;
    }>(
      `SELECT t.id, t.doc_type, t.paper, t.orientation, v.id AS vid, v.created_at AS vcreated, v.body
         FROM document_templates t
         JOIN document_template_versions v ON v.id = t.current_version_id
        WHERE t.id = $1 AND t.tenant_id = $2 AND t.deleted_at IS NULL AND t.status = 'published'`,
      [templateId, tenantId],
    );
    if (r.rows.length === 0) {
      throw new NotFoundException('Published template not found');
    }
    const t = r.rows[0];
    return {
      templateId: t.id,
      docType: t.doc_type,
      versionId: t.vid,
      versionCreatedAt: t.vcreated,
      paper: t.paper,
      orientation: t.orientation,
      body: t.body,
    };
  }

  /** Explicit template, else the branch assignment, else the tenant assignment, else the default. */
  private async resolveTemplateId(
    client: PoolClient,
    tenantId: string,
    branchId: string | null,
    docType: string,
    explicit?: string,
  ): Promise<string> {
    if (explicit) return explicit;
    if (branchId) {
      const b = await client.query<{ template_id: string }>(
        `SELECT template_id FROM document_template_assignments
          WHERE tenant_id = $1 AND doc_type = $2 AND scope = 'branch' AND branch_id = $3
            AND deleted_at IS NULL`,
        [tenantId, docType, branchId],
      );
      if (b.rows[0]) return b.rows[0].template_id;
    }
    const t = await client.query<{ template_id: string }>(
      `SELECT template_id FROM document_template_assignments
        WHERE tenant_id = $1 AND doc_type = $2 AND scope = 'tenant' AND deleted_at IS NULL`,
      [tenantId, docType],
    );
    if (t.rows[0]) return t.rows[0].template_id;
    const d = await client.query<{ id: string }>(
      `SELECT id FROM document_templates
        WHERE tenant_id = $1 AND doc_type = $2 AND is_default = TRUE AND status = 'published'
          AND deleted_at IS NULL`,
      [tenantId, docType],
    );
    if (d.rows[0]) return d.rows[0].id;
    throw new NotFoundException(`No published template is set for ${docType}`);
  }

  // ------------------------------------------------------------------ authorization

  /**
   * Every asset the template uses must be available; stamps and signatures additionally need a
   * current approval and permission for this issuer. Returns the asset rows for the snapshot.
   */
  private async authorizeAssets(
    client: PoolClient,
    tenantId: string,
    pub: Published,
    actor: Actor,
    branchId: string | null,
  ): Promise<AssetRow[]> {
    const ids = referencedAssetIds(pub.body);
    if (ids.length === 0) return [];
    const r = await client.query<AssetRow>(
      `SELECT id, category, storage_path, mime, checksum, status FROM document_assets
        WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL`,
      [tenantId, ids],
    );
    if (
      r.rows.length !== ids.length ||
      r.rows.some((a) => a.status !== 'active')
    ) {
      // a missing stamp on a legal document must stop the issue, never be silently dropped
      throw new BadRequestException(
        'A stamp, signature or image used by the template is unavailable',
      );
    }
    const sensitive = r.rows.filter((a) =>
      SENSITIVE_ASSET_CATEGORIES.includes(a.category as never),
    );
    if (sensitive.length === 0) return r.rows;

    // 1) an approval made AFTER this version was published, and still the latest decision
    const last = await client.query<{ decision: string; approved_at: Date }>(
      `SELECT decision, approved_at FROM document_approvals
        WHERE tenant_id = $1 AND template_id = $2
        ORDER BY approved_at DESC LIMIT 1`,
      [tenantId, pub.templateId],
    );
    const a = last.rows[0];
    if (
      !a ||
      a.decision !== 'approved' ||
      a.approved_at < pub.versionCreatedAt
    ) {
      throw new ForbiddenException(
        'This template uses a stamp or signature and has no current approval',
      );
    }

    // 2) the issuer may use each sensitive asset
    const roleIds = actor.roles.length
      ? (
          await client.query<{ id: string }>(
            `SELECT id FROM roles WHERE name = ANY($1::text[]) AND (tenant_id IS NULL OR tenant_id = $2)`,
            [actor.roles, tenantId],
          )
        ).rows.map((x) => x.id)
      : [];
    for (const asset of sensitive) {
      const perms = await client.query<{
        role_id: string | null;
        branch_id: string | null;
        can_use: boolean;
      }>(
        `SELECT role_id, branch_id, can_use FROM document_asset_permissions
          WHERE asset_id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
        [asset.id, tenantId],
      );
      if (perms.rows.length === 0) continue; // no restriction configured
      const matches = perms.rows.filter(
        (p) =>
          (p.role_id === null && p.branch_id === null) ||
          (p.role_id !== null && roleIds.includes(p.role_id)) ||
          (p.branch_id !== null && p.branch_id === branchId),
      );
      if (matches.some((p) => !p.can_use) || !matches.some((p) => p.can_use)) {
        throw new ForbiddenException(
          'You are not allowed to use one of the stamps or signatures',
        );
      }
    }
    return r.rows;
  }

  // ------------------------------------------------------------------ issue

  private async assetDataUris(
    rows: AssetRow[],
  ): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const a of rows) {
      const url = await this.storage.getSignedUrl(a.storage_path, 60);
      const res = await fetch(url);
      if (!res.ok)
        throw new BadRequestException('Could not read an asset file');
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0 || buf.length > MAX_ASSET_BYTES) {
        throw new BadRequestException('Asset file has an invalid size');
      }
      // embedded: the snapshot never depends on a URL that can expire
      out[a.id] = `data:${a.mime};base64,${buf.toString('base64')}`;
    }
    return out;
  }

  private async resolveSource(
    client: PoolClient,
    tenantId: string,
    branchId: string | null,
    dto: IssueDocumentDto,
    lang: Lang,
    now: Date,
  ): Promise<ResolvedDocument> {
    if (ORDER_DOC_TYPES.includes(dto.doc_type)) {
      if (!/^[0-9a-f-]{36}$/i.test(dto.source_id)) {
        throw new BadRequestException(
          'source_id must be a sale id for this document type',
        );
      }
      return resolveOrder(client, tenantId, dto.source_id, lang);
    }
    return resolveManual(
      client,
      tenantId,
      branchId,
      dto.doc_type,
      dto.source_id,
      dto.input,
      lang,
      now,
    );
  }

  async issue(tenant: TenantContext, actor: Actor, dto: IssueDocumentDto) {
    const tenantId = this.tid(tenant);
    const lang: Lang = dto.lang === 'en' ? 'en' : 'ar';
    const now = new Date();
    const branchId = tenant.branchId ?? null;

    // 1) read-only: template, data and authorization (fail fast, before any rendering)
    const prep = await this.tenantSession.runInTenantContext(
      tenant,
      async (client) => {
        const templateId = await this.resolveTemplateId(
          client,
          tenantId,
          branchId,
          dto.doc_type,
          dto.template_id,
        );
        const pub = await this.loadPublished(client, tenantId, templateId);
        if (pub.docType !== dto.doc_type) {
          throw new BadRequestException(
            'Template does not match the document type',
          );
        }
        const assets = await this.authorizeAssets(
          client,
          tenantId,
          pub,
          actor,
          branchId,
        );
        const resolved = await this.resolveSource(
          client,
          tenantId,
          branchId,
          dto,
          lang,
          now,
        );
        return { pub, assets, resolved };
      },
    );

    // 2) render the immutable snapshot (HTML with embedded images, QR, PDF)
    const docId = randomUUID();
    const token = newVerificationToken();
    const base = (
      this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000'
    ).replace(/\/+$/, '');
    const { resolved, pub } = prep;
    const company = (resolved.data.company ?? {}) as Record<
      string,
      string | undefined
    >;
    const payment = (resolved.data.payment ?? {}) as Record<
      string,
      string | undefined
    >;
    const zatca =
      resolved.zatcaQr ??
      (company.name && company.vat_number
        ? buildZatcaQrBase64({
            sellerName: company.name,
            vatNumber: company.vat_number,
            timestamp: now,
            totalWithVat: resolved.money.total,
            vatAmount: resolved.money.vat,
          })
        : undefined);
    const warnings: string[] = [];
    const html = this.renderer.render({
      body: pub.body,
      paper: pub.paper,
      orientation: pub.orientation,
      direction: lang === 'en' ? 'ltr' : 'rtl',
      data: resolved.data,
      assetUrls: await this.assetDataUris(prep.assets),
      qr: {
        verificationUrl: `${base}/${lang}/public/verify/${token}`,
        zatca,
        payment: payment.iban,
      },
      warnings,
    });
    if (warnings.length > 0) {
      // an unscannable QR on an issued document is worse than not issuing it
      throw new BadRequestException(warnings.join('; '));
    }
    const pdfBuffer = await this.pdf.renderDocument(html);
    const up = await this.storage.upload({
      tenantId,
      ownerType: 'document',
      ownerId: docId,
      uploadedBy: actor.userId,
      fileName: `${resolved.documentNumber}.pdf`,
      fileType: 'application/pdf',
      fileBuffer: pdfBuffer,
    });

    // 3) commit: re-check authorization (it may have changed meanwhile), then insert the snapshot
    const assetRefs = prep.assets.map((a) => ({
      asset_id: a.id,
      category: a.category,
      storage_path: a.storage_path,
      mime: a.mime,
      checksum: a.checksum,
    }));
    await this.tenantSession.runInTenantContext(tenant, async (client) => {
      const again = await this.loadPublished(client, tenantId, pub.templateId);
      if (again.versionId !== pub.versionId) {
        throw new ConflictException(
          'The template was republished while issuing; try again',
        );
      }
      await this.authorizeAssets(client, tenantId, again, actor, branchId);
      await client.query(
        `INSERT INTO generated_documents
           (id, tenant_id, doc_type, source_ref, template_version_id, rendered_html,
            resolved_data, asset_refs, pdf_storage_path, issued_by, issued_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11)`,
        [
          docId,
          tenantId,
          dto.doc_type,
          resolved.sourceRef,
          pub.versionId,
          html,
          JSON.stringify(resolved.data),
          JSON.stringify(assetRefs),
          up.storagePath,
          actor.userId,
          now,
        ],
      );
      await this.verification.createToken(
        client,
        tenantId,
        docId,
        {
          document_number: resolved.documentNumber,
          document_date: resolved.documentDate,
          issuer_name: company.name,
          issuer_vat_number: company.vat_number,
          total: resolved.money.total,
        },
        null,
        token,
      );
    });

    await this.audit.log({
      tenant_id: tenantId,
      actor_id: actor.userId,
      action: 'document.issue',
      resource_type: 'generated_document',
      resource_id: docId,
      branch_id: branchId,
      after_data: {
        doc_type: dto.doc_type,
        source_ref: resolved.sourceRef,
        template_id: pub.templateId,
        template_version_id: pub.versionId,
        // which stamps / signatures were used (ids only; never the files or URLs)
        assets: assetRefs.map((a) => ({
          asset_id: a.asset_id,
          category: a.category,
        })),
        sha256: createHash('sha256').update(html).digest('hex'),
      },
    });

    return {
      id: docId,
      doc_type: dto.doc_type,
      document_number: resolved.documentNumber,
      verification_url: `${base}/${lang}/public/verify/${token}`,
    };
  }

  // ------------------------------------------------------------------ read / void

  list(
    tenant: TenantContext,
    f: { docType?: string; sourceRef?: string; limit?: number },
  ) {
    const tenantId = this.tid(tenant);
    const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
    return this.tenantSession.runInTenantContext(tenant, async (client) => {
      const r = await client.query<Row>(
        `SELECT id, doc_type, source_ref, status, issued_by, issued_at,
                resolved_data->'document'->>'number' AS document_number
           FROM generated_documents
          WHERE tenant_id = $1 AND deleted_at IS NULL
            AND ($2::text IS NULL OR doc_type = $2)
            AND ($3::text IS NULL OR source_ref = $3)
          ORDER BY issued_at DESC LIMIT $4`,
        [tenantId, f.docType ?? null, f.sourceRef ?? null, limit],
      );
      return r.rows;
    });
  }

  private async row(client: PoolClient, tenantId: string, id: string) {
    const r = await client.query<{
      id: string;
      doc_type: string;
      source_ref: string | null;
      status: string;
      issued_at: Date;
      issued_by: string | null;
      resolved_data: Row;
      asset_refs: Row[];
      rendered_html: string;
      pdf_storage_path: string | null;
    }>(
      `SELECT id, doc_type, source_ref, status, issued_at, issued_by, resolved_data,
              asset_refs, rendered_html, pdf_storage_path
         FROM generated_documents WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [id, tenantId],
    );
    if (r.rows.length === 0) throw new NotFoundException('Document not found');
    return r.rows[0];
  }

  get(tenant: TenantContext, id: string) {
    const tenantId = this.tid(tenant);
    return this.tenantSession.runInTenantContext(tenant, async (client) => {
      const r = await this.row(client, tenantId, id);
      // metadata only: the stored HTML / PDF path are not part of the API response
      return {
        id: r.id,
        doc_type: r.doc_type,
        source_ref: r.source_ref,
        status: r.status,
        issued_at: r.issued_at,
        issued_by: r.issued_by,
        resolved_data: r.resolved_data,
        asset_refs: r.asset_refs,
      };
    });
  }

  async html(tenant: TenantContext, id: string) {
    const tenantId = this.tid(tenant);
    const r = await this.tenantSession.runInTenantContext(tenant, (c) =>
      this.row(c, tenantId, id),
    );
    return { html: r.rendered_html };
  }

  /** The PDF exactly as issued (stored); re-rendered from the stored HTML only if it is missing. */
  async pdfBytes(
    tenant: TenantContext,
    id: string,
  ): Promise<{ bytes: Buffer; name: string }> {
    const tenantId = this.tid(tenant);
    const r = await this.tenantSession.runInTenantContext(tenant, (c) =>
      this.row(c, tenantId, id),
    );
    const number = ((r.resolved_data.document ?? {}) as Row).number;
    const name = `${typeof number === 'string' ? number : r.id}.pdf`.replace(
      /[^\w.-]/g,
      '_',
    );
    if (r.pdf_storage_path) {
      const url = await this.storage.getSignedUrl(r.pdf_storage_path, 60);
      const res = await fetch(url);
      if (res.ok) return { bytes: Buffer.from(await res.arrayBuffer()), name };
    }
    return { bytes: await this.pdf.renderDocument(r.rendered_html), name };
  }

  async voidDocument(
    tenant: TenantContext,
    actor: Actor,
    id: string,
    dto: VoidDocumentDto,
  ) {
    const tenantId = this.tid(tenant);
    await this.tenantSession.runInTenantContext(tenant, async (client) => {
      const r = await client.query(
        `UPDATE generated_documents SET status = 'void'
          WHERE id = $1 AND tenant_id = $2 AND status = 'issued' AND deleted_at IS NULL`,
        [id, tenantId],
      );
      if (r.rowCount === 0)
        throw new NotFoundException('Issued document not found');
    });
    await this.audit.log({
      tenant_id: tenantId,
      actor_id: actor.userId,
      action: 'document.void',
      resource_type: 'generated_document',
      resource_id: id,
      after_data: { reason: dto.reason },
    });
    return { id, status: 'void' };
  }

  // ------------------------------------------------------------------ approvals

  async createApproval(
    tenant: TenantContext,
    actor: Actor,
    dto: CreateApprovalDto,
  ) {
    const tenantId = this.tid(tenant);
    const row = await this.tenantSession.runInTenantContext(
      tenant,
      async (client) => {
        const pub = await this.loadPublished(client, tenantId, dto.template_id);
        const r = await client.query<Row>(
          `INSERT INTO document_approvals (tenant_id, doc_type, template_id, approver_id, decision, reason)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id, doc_type, template_id, approver_id, decision, reason, approved_at`,
          [
            tenantId,
            pub.docType,
            pub.templateId,
            actor.userId,
            dto.decision,
            dto.reason ?? null,
          ],
        );
        return r.rows[0];
      },
    );
    await this.audit.log({
      tenant_id: tenantId,
      actor_id: actor.userId,
      action: `document.approval.${dto.decision}`,
      resource_type: 'document_template',
      resource_id: dto.template_id,
      after_data: { reason: dto.reason ?? null },
    });
    return row;
  }

  listApprovals(
    tenant: TenantContext,
    f: { docType?: string; templateId?: string },
  ) {
    const tenantId = this.tid(tenant);
    return this.tenantSession.runInTenantContext(tenant, async (client) => {
      const r = await client.query<Row>(
        `SELECT id, doc_type, template_id, approver_id, decision, reason, approved_at
           FROM document_approvals
          WHERE tenant_id = $1
            AND ($2::text IS NULL OR doc_type = $2)
            AND ($3::uuid IS NULL OR template_id = $3)
          ORDER BY approved_at DESC LIMIT 200`,
        [tenantId, f.docType ?? null, f.templateId ?? null],
      );
      return r.rows;
    });
  }
}
