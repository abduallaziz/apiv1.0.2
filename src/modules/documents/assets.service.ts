import { createHash } from 'crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { TenantContext } from '../../core/tenant/tenant-context';
import { TenantSessionService } from '../../core/tenant/tenant-session.service';
import { StorageService } from '../../shared/storage/storage.service';
import { AuditService } from '../../core/audit/audit.service';
import {
  AssetPermissionDto,
  CreateAssetDto,
  SENSITIVE_ASSET_CATEGORIES,
  UpdateAssetDto,
} from './dto/asset.dto';

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp'];
// short-lived: assets are never exposed through a stable URL
const SIGNED_URL_SECONDS = 300;

// Public metadata only: storage_path is never returned to clients.
const PUBLIC_COLUMNS =
  'id, tenant_id, branch_id, category, name, mime, width_px, height_px, checksum, status, created_by, created_at, updated_at';

type Row = Record<string, unknown>;

/** Reads width/height from a PNG header; null for other formats (not needed for correctness). */
function pngSize(buf: Buffer): { w: number; h: number } | null {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 24 || !buf.subarray(0, 8).equals(sig)) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

/** The declared mime type must match the file's real magic bytes. */
function sniffMime(buf: Buffer): string | null {
  if (buf.length >= 8 && pngSize(buf)) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return 'image/jpeg';
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString() === 'RIFF' &&
    buf.subarray(8, 12).toString() === 'WEBP'
  )
    return 'image/webp';
  return null;
}

// Asset library (Phase 3): private stamps/signatures/logos. Files live in the private bucket via
// StorageService; clients only ever get metadata or a short-lived signed URL.
@Injectable()
export class AssetsService {
  constructor(
    private readonly tenantSession: TenantSessionService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  private tid(tenant: TenantContext): string {
    if (!tenant.tenantId)
      throw new BadRequestException('Tenant context missing');
    return tenant.tenantId;
  }

  private validateFile(file: Express.Multer.File | undefined) {
    if (!file?.buffer?.length)
      throw new BadRequestException('file is required');
    if (file.size > MAX_BYTES)
      throw new BadRequestException('File is larger than 5MB');
    const real = sniffMime(file.buffer);
    if (!real || !ALLOWED_MIME.includes(real)) {
      throw new BadRequestException(
        'Only PNG, JPEG or WEBP images are allowed',
      );
    }
    return real;
  }

  private async lockAsset(client: PoolClient, tenantId: string, id: string) {
    const r = await client.query<
      Row & { storage_path: string; category: string }
    >(
      `SELECT * FROM document_assets
        WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [id, tenantId],
    );
    if (r.rows.length === 0) throw new NotFoundException('Asset not found');
    return r.rows[0];
  }

  private async assertBranch(
    client: PoolClient,
    tenantId: string,
    branchId?: string | null,
  ) {
    if (!branchId) return;
    const b = await client.query(
      `SELECT 1 FROM branches WHERE id = $1 AND tenant_id = $2`,
      [branchId, tenantId],
    );
    if (b.rows.length === 0) throw new NotFoundException('Branch not found');
  }

  // ------------------------------------------------------------------ read

  list(tenant: TenantContext, filters: { category?: string; status?: string }) {
    const tenantId = this.tid(tenant);
    return this.tenantSession.runInTenantContext(tenant, async (client) => {
      const r = await client.query<Row>(
        `SELECT ${PUBLIC_COLUMNS} FROM document_assets
          WHERE tenant_id = $1 AND deleted_at IS NULL
            AND ($2::text IS NULL OR category = $2)
            AND ($3::text IS NULL OR status = $3)
          ORDER BY category, name`,
        [tenantId, filters.category ?? null, filters.status ?? null],
      );
      return r.rows;
    });
  }

  get(tenant: TenantContext, id: string) {
    const tenantId = this.tid(tenant);
    return this.tenantSession.runInTenantContext(tenant, async (client) => {
      const r = await client.query<Row>(
        `SELECT ${PUBLIC_COLUMNS} FROM document_assets
          WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
        [id, tenantId],
      );
      if (r.rows.length === 0) throw new NotFoundException('Asset not found');
      const v = await client.query<Row>(
        `SELECT version, created_by, created_at FROM document_asset_versions
          WHERE asset_id = $1 AND deleted_at IS NULL ORDER BY version DESC`,
        [id],
      );
      return { ...r.rows[0], versions: v.rows };
    });
  }

  // ------------------------------------------------------------------ write

  async create(
    tenant: TenantContext,
    userId: string,
    dto: CreateAssetDto,
    file: Express.Multer.File | undefined,
  ) {
    const tenantId = this.tid(tenant);
    const mime = this.validateFile(file);
    const buf = file.buffer;
    const size = pngSize(buf);
    const up = await this.storage.upload({
      tenantId,
      ownerType: 'document-asset',
      ownerId: dto.category,
      uploadedBy: userId,
      fileName: file.originalname || 'asset',
      fileType: mime,
      fileBuffer: buf,
    });
    const checksum = createHash('sha256').update(buf).digest('hex');
    const created = await this.tenantSession.runInTenantContext(
      tenant,
      async (client) => {
        await this.assertBranch(client, tenantId, dto.branch_id);
        const a = await client.query<Row>(
          `INSERT INTO document_assets
             (tenant_id, branch_id, category, name, storage_path, mime, width_px, height_px, checksum, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           RETURNING ${PUBLIC_COLUMNS}`,
          [
            tenantId,
            dto.branch_id ?? null,
            dto.category,
            dto.name,
            up.storagePath,
            mime,
            size?.w ?? null,
            size?.h ?? null,
            checksum,
            userId,
          ],
        );
        await client.query(
          `INSERT INTO document_asset_versions (tenant_id, asset_id, version, storage_path, created_by)
           VALUES ($1, $2, 1, $3, $4)`,
          [tenantId, a.rows[0].id, up.storagePath, userId],
        );
        return a.rows[0];
      },
    );
    await this.audit.log({
      tenant_id: tenantId,
      actor_id: userId,
      action: 'document_asset.upload',
      resource_type: 'document_asset',
      resource_id: created.id as string,
      after_data: { category: dto.category, name: dto.name, checksum },
    });
    return created;
  }

  async replaceFile(
    tenant: TenantContext,
    userId: string,
    id: string,
    file: Express.Multer.File | undefined,
  ) {
    const tenantId = this.tid(tenant);
    const mime = this.validateFile(file);
    const buf = file.buffer;
    const size = pngSize(buf);
    const up = await this.storage.upload({
      tenantId,
      ownerType: 'document-asset',
      ownerId: id,
      uploadedBy: userId,
      fileName: file.originalname || 'asset',
      fileType: mime,
      fileBuffer: buf,
    });
    const checksum = createHash('sha256').update(buf).digest('hex');
    const result = await this.tenantSession.runInTenantContext(
      tenant,
      async (client) => {
        await this.lockAsset(client, tenantId, id);
        const v = await client.query<{ version: number }>(
          `INSERT INTO document_asset_versions (tenant_id, asset_id, version, storage_path, created_by)
           VALUES ($1, $2,
             COALESCE((SELECT MAX(version) FROM document_asset_versions WHERE asset_id = $2), 0) + 1,
             $3, $4)
           RETURNING version`,
          [tenantId, id, up.storagePath, userId],
        );
        await client.query(
          `UPDATE document_assets SET storage_path = $3, mime = $4, width_px = $5,
                  height_px = $6, checksum = $7, updated_at = NOW()
            WHERE id = $1 AND tenant_id = $2`,
          [
            id,
            tenantId,
            up.storagePath,
            mime,
            size?.w ?? null,
            size?.h ?? null,
            checksum,
          ],
        );
        return { id, version: v.rows[0].version };
      },
    );
    await this.audit.log({
      tenant_id: tenantId,
      actor_id: userId,
      action: 'document_asset.replace',
      resource_type: 'document_asset',
      resource_id: id,
      after_data: { version: result.version, checksum },
    });
    return result;
  }

  update(tenant: TenantContext, id: string, dto: UpdateAssetDto) {
    const tenantId = this.tid(tenant);
    return this.tenantSession.runInTenantContext(tenant, async (client) => {
      await this.lockAsset(client, tenantId, id);
      const r = await client.query<Row>(
        `UPDATE document_assets SET name = COALESCE($3, name),
                status = COALESCE($4, status), updated_at = NOW()
          WHERE id = $1 AND tenant_id = $2 RETURNING ${PUBLIC_COLUMNS}`,
        [id, tenantId, dto.name ?? null, dto.status ?? null],
      );
      return r.rows[0];
    });
  }

  remove(tenant: TenantContext, id: string) {
    const tenantId = this.tid(tenant);
    return this.tenantSession.runInTenantContext(tenant, async (client) => {
      await this.lockAsset(client, tenantId, id);
      await client.query(
        `UPDATE document_assets SET deleted_at = NOW(), status = 'archived'
          WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId],
      );
      return { message: 'Asset deleted' };
    });
  }

  // ------------------------------------------------------------------ signed URL

  async signedUrl(tenant: TenantContext, userId: string, id: string) {
    const tenantId = this.tid(tenant);
    const asset = await this.tenantSession.runInTenantContext(
      tenant,
      (client) => this.lockAsset(client, tenantId, id),
    );
    if (asset.status === 'archived') {
      throw new BadRequestException('Archived assets cannot be accessed');
    }
    const url = await this.storage.getSignedUrl(
      asset.storage_path,
      SIGNED_URL_SECONDS,
    );
    if (SENSITIVE_ASSET_CATEGORIES.includes(asset.category as never)) {
      // stamp/signature access is audited (the URL itself is never logged)
      await this.audit.log({
        tenant_id: tenantId,
        actor_id: userId,
        action: 'document_asset.signed_url',
        resource_type: 'document_asset',
        resource_id: id,
      });
    }
    return { url, expires_in: SIGNED_URL_SECONDS };
  }

  /**
   * Signed URLs for the assets a template uses (render engine). Only ACTIVE assets of THIS tenant
   * are resolved; ids of other tenants / archived / unknown assets are silently left out, so a
   * forged assetId in a template body can never pull another tenant's stamp.
   */
  async signedUrlsFor(
    tenant: TenantContext,
    ids: string[],
  ): Promise<Record<string, string>> {
    const tenantId = this.tid(tenant);
    const valid = ids.filter((i) => /^[0-9a-f-]{36}$/i.test(i));
    if (valid.length === 0) return {};
    const rows = await this.tenantSession.runInTenantContext(
      tenant,
      async (client) => {
        const r = await client.query<{ id: string; storage_path: string }>(
          `SELECT id, storage_path FROM document_assets
            WHERE tenant_id = $1 AND id = ANY($2::uuid[])
              AND status = 'active' AND deleted_at IS NULL`,
          [tenantId, valid],
        );
        return r.rows;
      },
    );
    const out: Record<string, string> = {};
    for (const row of rows) {
      out[row.id] = await this.storage.getSignedUrl(
        row.storage_path,
        SIGNED_URL_SECONDS,
      );
    }
    return out;
  }

  // ------------------------------------------------------------------ permissions

  permissions(tenant: TenantContext, id: string) {
    const tenantId = this.tid(tenant);
    return this.tenantSession.runInTenantContext(tenant, async (client) => {
      await this.lockAsset(client, tenantId, id);
      const r = await client.query<Row>(
        `SELECT id, role_id, branch_id, can_use, created_at
           FROM document_asset_permissions
          WHERE asset_id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
        [id, tenantId],
      );
      return r.rows;
    });
  }

  addPermission(tenant: TenantContext, id: string, dto: AssetPermissionDto) {
    const tenantId = this.tid(tenant);
    return this.tenantSession.runInTenantContext(tenant, async (client) => {
      await this.lockAsset(client, tenantId, id);
      await this.assertBranch(client, tenantId, dto.branch_id);
      if (dto.role_id) {
        // roles may be tenant-specific or global: only reject ids that are tenant-owned by another tenant
        const role = await client.query<{ tenant_id: string | null }>(
          `SELECT tenant_id FROM roles WHERE id = $1`,
          [dto.role_id],
        );
        if (
          role.rows.length === 0 ||
          (role.rows[0].tenant_id && role.rows[0].tenant_id !== tenantId)
        ) {
          throw new NotFoundException('Role not found');
        }
      }
      const r = await client.query<Row>(
        `INSERT INTO document_asset_permissions (tenant_id, asset_id, role_id, branch_id, can_use)
         VALUES ($1,$2,$3,$4,$5) RETURNING id, role_id, branch_id, can_use`,
        [
          tenantId,
          id,
          dto.role_id ?? null,
          dto.branch_id ?? null,
          dto.can_use ?? true,
        ],
      );
      return r.rows[0];
    });
  }

  removePermission(tenant: TenantContext, id: string, permissionId: string) {
    const tenantId = this.tid(tenant);
    return this.tenantSession.runInTenantContext(tenant, async (client) => {
      await this.lockAsset(client, tenantId, id);
      const r = await client.query(
        `UPDATE document_asset_permissions SET deleted_at = NOW()
          WHERE id = $1 AND asset_id = $2 AND tenant_id = $3 AND deleted_at IS NULL`,
        [permissionId, id, tenantId],
      );
      if (r.rowCount === 0) throw new NotFoundException('Permission not found');
      return { message: 'Permission removed' };
    });
  }
}
