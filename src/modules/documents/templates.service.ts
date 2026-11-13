import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { TenantContext } from '../../core/tenant/tenant-context';
import { TenantSessionService } from '../../core/tenant/tenant-session.service';
import {
  AssignTemplateDto,
  CreateTemplateDto,
  UpdateTemplateDto,
} from './dto/template.dto';
import type { DocumentType } from './document.types';
import { referencedAssetIds, sanitizeBody } from './template-body.util';

interface TemplateRow {
  id: string;
  tenant_id: string;
  doc_type: DocumentType;
  name: string;
  status: 'draft' | 'published' | 'archived';
  is_default: boolean;
  paper: string;
  orientation: string;
  current_version_id: string | null;
}

const EMPTY_BODY = (paper: string, orientation: string) => ({
  pages: [{ size: paper, orientation }],
  elements: [],
  bindings: [],
});

// Template management (Phase 2). Versioning rules:
//  - current_version_id = the PUBLISHED version (null until first publish).
//  - the working draft = the highest version number. Editing while the latest version is the
//    published one creates a NEW version; editing an unpublished draft updates it in place (it has
//    never been used to issue anything). Published versions are never mutated.
//  - restore(v) copies an old body into a new draft version.
// All queries run through TenantSessionService so RLS is bound to the tenant.
@Injectable()
export class TemplatesService {
  constructor(private readonly tenantSession: TenantSessionService) {}

  // ------------------------------------------------------------------ helpers

  private async lockTemplate(
    client: PoolClient,
    tenantId: string,
    id: string,
  ): Promise<TemplateRow> {
    const r = await client.query<TemplateRow>(
      `SELECT * FROM document_templates
        WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [id, tenantId],
    );
    if (r.rows.length === 0) throw new NotFoundException('Template not found');
    return r.rows[0];
  }

  private async latestVersion(client: PoolClient, templateId: string) {
    const r = await client.query<{
      id: string;
      version: number;
      body: Record<string, unknown>;
    }>(
      `SELECT id, version, body FROM document_template_versions
        WHERE template_id = $1 AND deleted_at IS NULL
        ORDER BY version DESC LIMIT 1`,
      [templateId],
    );
    return r.rows[0];
  }

  private async insertVersion(
    client: PoolClient,
    tenantId: string,
    templateId: string,
    body: Record<string, unknown>,
    userId: string | null,
    note?: string,
  ) {
    const r = await client.query<{ id: string; version: number }>(
      `INSERT INTO document_template_versions (tenant_id, template_id, version, body, note, created_by)
       VALUES ($1, $2,
         COALESCE((SELECT MAX(version) FROM document_template_versions WHERE template_id = $2), 0) + 1,
         $3::jsonb, $4, $5)
       RETURNING id, version`,
      [tenantId, templateId, JSON.stringify(body), note ?? null, userId],
    );
    return r.rows[0];
  }

  /** Every asset a body references must exist in THIS tenant (never another tenant's stamp). */
  private async assertAssetsOwned(
    client: PoolClient,
    tenantId: string,
    body: Record<string, unknown>,
  ) {
    const ids = referencedAssetIds(body);
    if (ids.length === 0) return;
    const r = await client.query<{ id: string }>(
      `SELECT id FROM document_assets
        WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL`,
      [tenantId, ids],
    );
    if (r.rows.length !== ids.length) {
      throw new BadRequestException(
        'Invalid template body: an asset does not exist',
      );
    }
  }

  private tid(tenant: TenantContext): string {
    if (!tenant.tenantId)
      throw new BadRequestException('Tenant context missing');
    return tenant.tenantId;
  }

  // ------------------------------------------------------------------ read

  list(tenant: TenantContext, filters: { docType?: string; status?: string }) {
    const tenantId = this.tid(tenant);
    return this.tenantSession.runInTenantContext(tenant, async (client) => {
      const r = await client.query<Record<string, unknown>>(
        `SELECT id, doc_type, name, description, status, is_default, paper, orientation,
                current_version_id, created_at, updated_at
           FROM document_templates
          WHERE tenant_id = $1 AND deleted_at IS NULL
            AND ($2::text IS NULL OR doc_type = $2)
            AND ($3::text IS NULL OR status = $3)
          ORDER BY doc_type, is_default DESC, name`,
        [tenantId, filters.docType ?? null, filters.status ?? null],
      );
      return r.rows;
    });
  }

  get(tenant: TenantContext, id: string) {
    const tenantId = this.tid(tenant);
    return this.tenantSession.runInTenantContext(tenant, async (client) => {
      const t = await client.query<Record<string, unknown>>(
        `SELECT * FROM document_templates
          WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
        [id, tenantId],
      );
      if (t.rows.length === 0)
        throw new NotFoundException('Template not found');
      const draft = await this.latestVersion(client, id);
      return {
        ...t.rows[0],
        draft_version: draft?.version ?? null,
        body: draft?.body ?? null,
      };
    });
  }

  versions(tenant: TenantContext, id: string) {
    const tenantId = this.tid(tenant);
    return this.tenantSession.runInTenantContext(tenant, async (client) => {
      await this.lockTemplate(client, tenantId, id);
      const r = await client.query<Record<string, unknown>>(
        `SELECT v.id, v.version, v.note, v.created_by, v.created_at,
                (v.id = t.current_version_id) AS is_published
           FROM document_template_versions v
           JOIN document_templates t ON t.id = v.template_id
          WHERE v.template_id = $1 AND v.deleted_at IS NULL
          ORDER BY v.version DESC`,
        [id],
      );
      return r.rows;
    });
  }

  assignments(tenant: TenantContext, id: string) {
    const tenantId = this.tid(tenant);
    return this.tenantSession.runInTenantContext(tenant, async (client) => {
      await this.lockTemplate(client, tenantId, id);
      const r = await client.query<Record<string, unknown>>(
        `SELECT id, scope, branch_id, doc_type, created_at
           FROM document_template_assignments
          WHERE template_id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
        [id, tenantId],
      );
      return r.rows;
    });
  }

  // ------------------------------------------------------------------ write

  async create(tenant: TenantContext, userId: string, dto: CreateTemplateDto) {
    const tenantId = this.tid(tenant);
    const paper = dto.paper ?? 'A4';
    const orientation = dto.orientation ?? 'portrait';
    const initialBody = dto.body ? sanitizeBody(dto.body) : null;
    return this.tenantSession.runInTenantContext(tenant, async (client) => {
      if (initialBody)
        await this.assertAssetsOwned(client, tenantId, initialBody);
      const t = await client.query<TemplateRow>(
        `INSERT INTO document_templates
           (tenant_id, doc_type, name, description, paper, orientation, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [
          tenantId,
          dto.doc_type,
          dto.name,
          dto.description ?? null,
          paper,
          orientation,
          userId,
        ],
      );
      const v = await this.insertVersion(
        client,
        tenantId,
        t.rows[0].id,
        initialBody ?? EMPTY_BODY(paper, orientation),
        userId,
        'Initial version',
      );
      return { ...t.rows[0], draft_version: v.version };
    });
  }

  update(
    tenant: TenantContext,
    userId: string,
    id: string,
    dto: UpdateTemplateDto,
  ) {
    const tenantId = this.tid(tenant);
    return this.tenantSession.runInTenantContext(tenant, async (client) => {
      const t = await this.lockTemplate(client, tenantId, id);
      if (t.status === 'archived') {
        throw new ConflictException('Archived templates cannot be edited');
      }
      await client.query(
        `UPDATE document_templates SET
           name = COALESCE($3, name),
           description = COALESCE($4, description),
           paper = COALESCE($5, paper),
           orientation = COALESCE($6, orientation),
           updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2`,
        [
          id,
          tenantId,
          dto.name ?? null,
          dto.description ?? null,
          dto.paper ?? null,
          dto.orientation ?? null,
        ],
      );
      let draftVersion: number | null = null;
      if (dto.body) {
        const body = sanitizeBody(dto.body);
        await this.assertAssetsOwned(client, tenantId, body);
        const latest = await this.latestVersion(client, id);
        if (latest && latest.id !== t.current_version_id) {
          // unpublished draft: update in place
          await client.query(
            `UPDATE document_template_versions SET body = $2::jsonb, note = COALESCE($3, note)
              WHERE id = $1`,
            [latest.id, JSON.stringify(body), dto.note ?? null],
          );
          draftVersion = latest.version;
        } else {
          const v = await this.insertVersion(
            client,
            tenantId,
            id,
            body,
            userId,
            dto.note,
          );
          draftVersion = v.version;
        }
      }
      return { id, draft_version: draftVersion };
    });
  }

  publish(tenant: TenantContext, id: string) {
    const tenantId = this.tid(tenant);
    return this.tenantSession.runInTenantContext(tenant, async (client) => {
      const t = await this.lockTemplate(client, tenantId, id);
      if (t.status === 'archived') {
        throw new ConflictException('Archived templates cannot be published');
      }
      const latest = await this.latestVersion(client, id);
      if (!latest) throw new BadRequestException('Template has no version');
      await client.query(
        `UPDATE document_templates
            SET status = 'published', current_version_id = $3, updated_at = NOW()
          WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId, latest.id],
      );
      return { id, status: 'published', published_version: latest.version };
    });
  }

  archive(tenant: TenantContext, id: string) {
    const tenantId = this.tid(tenant);
    return this.tenantSession.runInTenantContext(tenant, async (client) => {
      await this.lockTemplate(client, tenantId, id);
      await client.query(
        `UPDATE document_templates
            SET status = 'archived', is_default = FALSE, updated_at = NOW()
          WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId],
      );
      // an archived template can no longer be applied anywhere
      await client.query(
        `UPDATE document_template_assignments SET deleted_at = NOW()
          WHERE template_id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
        [id, tenantId],
      );
      return { id, status: 'archived' };
    });
  }

  remove(tenant: TenantContext, id: string) {
    const tenantId = this.tid(tenant);
    return this.tenantSession.runInTenantContext(tenant, async (client) => {
      await this.lockTemplate(client, tenantId, id);
      await client.query(
        `UPDATE document_templates SET deleted_at = NOW(), is_default = FALSE
          WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId],
      );
      await client.query(
        `UPDATE document_template_assignments SET deleted_at = NOW()
          WHERE template_id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
        [id, tenantId],
      );
      return { message: 'Template deleted' };
    });
  }

  duplicate(tenant: TenantContext, userId: string, id: string) {
    const tenantId = this.tid(tenant);
    return this.tenantSession.runInTenantContext(tenant, async (client) => {
      const src = await this.lockTemplate(client, tenantId, id);
      const latest = await this.latestVersion(client, id);
      const copy = await client.query<TemplateRow>(
        `INSERT INTO document_templates
           (tenant_id, doc_type, name, description, paper, orientation, created_by)
         SELECT tenant_id, doc_type, $3, description, paper, orientation, $4
           FROM document_templates WHERE id = $1 AND tenant_id = $2
         RETURNING *`,
        [id, tenantId, `${src.name} (copy)`.slice(0, 120), userId],
      );
      const v = await this.insertVersion(
        client,
        tenantId,
        copy.rows[0].id,
        latest?.body ?? EMPTY_BODY(src.paper, src.orientation),
        userId,
        `Duplicated from ${src.name}`,
      );
      return { ...copy.rows[0], draft_version: v.version };
    });
  }

  setDefault(tenant: TenantContext, id: string) {
    const tenantId = this.tid(tenant);
    return this.tenantSession.runInTenantContext(tenant, async (client) => {
      const t = await this.lockTemplate(client, tenantId, id);
      if (t.status !== 'published') {
        throw new ConflictException(
          'Only a published template can be the default',
        );
      }
      await client.query(
        `UPDATE document_templates SET is_default = FALSE
          WHERE tenant_id = $1 AND doc_type = $2 AND is_default = TRUE AND id <> $3
            AND deleted_at IS NULL`,
        [tenantId, t.doc_type, id],
      );
      await client.query(
        `UPDATE document_templates SET is_default = TRUE, updated_at = NOW()
          WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId],
      );
      return { id, is_default: true };
    });
  }

  restoreVersion(
    tenant: TenantContext,
    userId: string,
    id: string,
    version: number,
  ) {
    const tenantId = this.tid(tenant);
    return this.tenantSession.runInTenantContext(tenant, async (client) => {
      const t = await this.lockTemplate(client, tenantId, id);
      if (t.status === 'archived') {
        throw new ConflictException('Archived templates cannot be edited');
      }
      const old = await client.query<{ body: Record<string, unknown> }>(
        `SELECT body FROM document_template_versions
          WHERE template_id = $1 AND version = $2 AND tenant_id = $3 AND deleted_at IS NULL`,
        [id, version, tenantId],
      );
      if (old.rows.length === 0)
        throw new NotFoundException('Version not found');
      const v = await this.insertVersion(
        client,
        tenantId,
        id,
        old.rows[0].body,
        userId,
        `Restored from version ${version}`,
      );
      return { id, draft_version: v.version };
    });
  }

  async assign(tenant: TenantContext, id: string, dto: AssignTemplateDto) {
    const tenantId = this.tid(tenant);
    if (dto.scope === 'branch' && !dto.branch_id) {
      throw new BadRequestException('branch_id is required for branch scope');
    }
    if (dto.scope === 'tenant' && dto.branch_id) {
      throw new BadRequestException('branch_id must be empty for tenant scope');
    }
    return this.tenantSession.runInTenantContext(tenant, async (client) => {
      const t = await this.lockTemplate(client, tenantId, id);
      if (t.status !== 'published') {
        throw new ConflictException(
          'Only a published template can be assigned',
        );
      }
      if (dto.branch_id) {
        // ownership re-check: the branch must belong to this tenant
        const b = await client.query(
          `SELECT 1 FROM branches WHERE id = $1 AND tenant_id = $2`,
          [dto.branch_id, tenantId],
        );
        if (b.rows.length === 0)
          throw new NotFoundException('Branch not found');
      }
      // one assignment per (scope target, doc_type): replace the previous one
      await client.query(
        `UPDATE document_template_assignments SET deleted_at = NOW()
          WHERE tenant_id = $1 AND doc_type = $2 AND scope = $3
            AND branch_id IS NOT DISTINCT FROM $4 AND deleted_at IS NULL`,
        [tenantId, t.doc_type, dto.scope, dto.branch_id ?? null],
      );
      const r = await client.query<Record<string, unknown>>(
        `INSERT INTO document_template_assignments
           (tenant_id, template_id, scope, branch_id, doc_type)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, scope, branch_id, doc_type`,
        [tenantId, id, dto.scope, dto.branch_id ?? null, t.doc_type],
      );
      return r.rows[0];
    });
  }
}
