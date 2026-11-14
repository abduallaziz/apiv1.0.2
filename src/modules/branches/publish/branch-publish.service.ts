import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { TenantContext } from '../../../core/tenant/tenant-context';
import { BranchPublishRegistry } from './branch-publish.registry';
import { BranchPublicationsRepository } from './branch-publications.repository';
import {
  EntityPublisher,
  PublishContext,
  PublishMode,
  PublishResult,
  PublishRow,
  PublishTargetResult,
} from './branch-publish.types';

export interface PublishActor {
  userId: string | null;
  /** True for owner/central users (no own branch). Branch-restricted users can never publish. */
  central: boolean;
}

export interface PublishRequest {
  entity_type: string;
  source_ids: string[];
  target_branch_ids: string[] | 'all';
  mode: PublishMode;
}

@Injectable()
export class BranchPublishService {
  private readonly logger = new Logger(BranchPublishService.name);

  constructor(
    private readonly registry: BranchPublishRegistry,
    private readonly publications: BranchPublicationsRepository,
  ) {}

  listTypes() {
    return this.registry.list().map((p) => ({
      type: p.type,
      group: p.group,
      label_ar: p.labelAr,
      label_en: p.labelEn,
      supported: p.supported,
      reason: p.supported ? undefined : p.unsupportedReason,
    }));
  }

  /** Public entry: publishes records of the WORKING branch to other branches. */
  async publish(
    tenant: TenantContext,
    req: PublishRequest,
    actor: PublishActor,
  ): Promise<PublishResult> {
    if (!actor.central) {
      throw new ForbiddenException(
        'Only the owner / central users can publish to branches.',
      );
    }
    if (!tenant.tenantId) {
      throw new BadRequestException('Tenant context missing');
    }
    if (!tenant.isolated || !tenant.branchId) {
      throw new BadRequestException(
        'Branch isolation must be enabled to publish records to branches.',
      );
    }
    const publisher = this.requirePublisher(req.entity_type);
    return this.run(
      publisher,
      tenant.tenantId,
      tenant.branchId,
      req.source_ids,
      req.target_branch_ids,
      req.mode,
      actor.userId,
    );
  }

  /**
   * Branch-creation convenience: copies the 'setup' entity types of the main branch to a new branch
   * (copy_new, idempotent). Never throws: per-type failures are logged and skipped.
   */
  async copySetupFromMain(
    tenantId: string,
    mainBranchId: string,
    targetBranchId: string,
    userId: string | null,
  ): Promise<PublishResult[]> {
    // The setup entity types live in independent tables, so they are copied concurrently (this used to run
    // one type after another and took ~40 s). Rows of one type stay sequential (e.g. category parents).
    const results = await Promise.all(
      this.registry.setupTypes().map(async (publisher) => {
        try {
          const ctx = this.ctx(tenantId, mainBranchId, userId);
          const ids = await publisher.listSourceIds(ctx);
          if (!ids.length) return null;
          return await this.run(
            publisher,
            tenantId,
            mainBranchId,
            ids,
            [targetBranchId],
            'copy_new',
            userId,
          );
        } catch (e) {
          this.logger.warn(
            `copy setup "${publisher.type}" failed: ${(e as Error).message}`,
          );
          return null;
        }
      }),
    );
    return results.filter((r): r is PublishResult => r !== null);
  }

  private requirePublisher(type: string): EntityPublisher {
    const publisher = this.registry.get(type);
    if (!publisher) {
      throw new BadRequestException(`Unknown publishable type "${type}"`);
    }
    if (!publisher.supported) {
      throw new BadRequestException(
        `Publishing "${type}" is not supported: ${publisher.unsupportedReason ?? 'not available'}`,
      );
    }
    return publisher;
  }

  private ctx(
    tenantId: string,
    sourceBranchId: string,
    userId: string | null,
  ): PublishContext {
    return {
      tenantId,
      sourceBranchId,
      userId,
      db: this.publications.client,
    };
  }

  private async resolveTargets(
    tenantId: string,
    sourceBranchId: string,
    requested: string[] | 'all',
  ) {
    const active = (await this.publications.activeBranches(tenantId)).filter(
      (b) => b.id !== sourceBranchId,
    );
    if (requested === 'all') {
      if (!active.length) {
        throw new BadRequestException('There is no other active branch.');
      }
      return active;
    }
    const wanted = [...new Set(requested)];
    if (wanted.includes(sourceBranchId)) {
      throw new BadRequestException(
        'The source branch cannot be a publish target.',
      );
    }
    const byId = new Map(active.map((b) => [b.id, b]));
    if (wanted.some((id) => !byId.has(id))) {
      throw new BadRequestException(
        'Every target must be an active branch of this tenant.',
      );
    }
    return wanted.map((id) => byId.get(id));
  }

  private async run(
    publisher: EntityPublisher,
    tenantId: string,
    sourceBranchId: string,
    sourceIds: string[],
    requestedTargets: string[] | 'all',
    mode: PublishMode,
    userId: string | null,
  ): Promise<PublishResult> {
    const ctx = this.ctx(tenantId, sourceBranchId, userId);
    const ids = [...new Set(sourceIds)];
    const targets = await this.resolveTargets(
      tenantId,
      sourceBranchId,
      requestedTargets,
    );
    const rows = await publisher.loadSources(ctx, ids);
    if (rows.length !== ids.length) {
      throw new BadRequestException(
        'Some records were not found in the source branch.',
      );
    }

    const results: PublishTargetResult[] = [];
    for (const target of targets) {
      const res: PublishTargetResult = {
        branch_id: target.id,
        branch_name: target.name,
        created: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
        errors: [],
      };
      for (const row of rows) {
        try {
          const outcome = await this.publishOne(
            publisher,
            ctx,
            row,
            target.id,
            mode,
          );
          res[outcome] += 1;
        } catch (e) {
          res.failed += 1;
          res.errors.push({
            source_id: row.id,
            message: (e as { message?: string })?.message ?? 'failed',
          });
        }
      }
      results.push(res);
    }
    if (publisher.afterPublish) {
      try {
        await publisher.afterPublish(ctx);
      } catch (e) {
        this.logger.warn(`afterPublish failed: ${(e as Error).message}`);
      }
    }
    return {
      entity_type: publisher.type,
      mode,
      source_count: rows.length,
      results,
    };
  }

  /**
   * copy_new        creates what is missing; anything already there (published before, or matched by its
   *                 natural key) is left untouched -> skipped.
   * update_existing updates what is already there and creates what is missing.
   * Either way the provenance row is (re)written, so a second run never duplicates.
   */
  private async publishOne(
    publisher: EntityPublisher,
    ctx: PublishContext,
    row: PublishRow,
    targetBranchId: string,
    mode: PublishMode,
  ): Promise<'created' | 'updated' | 'skipped'> {
    let targetId = await this.publications.findTargetId(
      ctx.tenantId,
      publisher.type,
      row.id,
      targetBranchId,
    );
    if (targetId && !(await publisher.exists(ctx, targetId, targetBranchId))) {
      targetId = null;
    }
    if (!targetId) {
      targetId = await publisher.findExisting(ctx, row, targetBranchId);
    }

    let outcome: 'created' | 'updated' | 'skipped';
    if (targetId) {
      if (mode === 'update_existing') {
        await publisher.update(ctx, row, targetId, targetBranchId);
        outcome = 'updated';
      } else {
        outcome = 'skipped';
      }
    } else {
      targetId = await publisher.create(ctx, row, targetBranchId);
      outcome = 'created';
    }

    await this.publications.record({
      tenant_id: ctx.tenantId,
      entity_type: publisher.type,
      source_id: row.id,
      source_branch_id: ctx.sourceBranchId,
      target_branch_id: targetBranchId,
      target_id: targetId,
      created_by: ctx.userId,
    });
    return outcome;
  }
}
