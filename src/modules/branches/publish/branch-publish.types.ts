import { SupabaseClient } from '@supabase/supabase-js';

export type PublishMode = 'copy_new' | 'update_existing';

/** Loose row shape: the registry is generic over many tables. */
export type PublishRow = Record<string, any> & { id: string };

export interface PublishContext {
  tenantId: string;
  sourceBranchId: string;
  userId: string | null;
  db: SupabaseClient;
}

/**
 * One publishable entity type (docs/DESIGN_BRANCH_ISOLATION.md section 7).
 * The service owns authorization, target validation, provenance and counting; a publisher only knows
 * how to read, find, create and update ONE kind of record.
 */
export interface EntityPublisher {
  type: string;
  /** UI grouping: 'setup' types are the ones copied when a new branch asks to copy the main branch's setup. */
  group: 'setup' | 'catalog' | 'promotions' | 'hr' | 'finance' | 'documents';
  labelAr: string;
  labelEn: string;
  supported: boolean;
  unsupportedReason?: string;
  /** Loads source rows by id; only rows of the source branch, tenant and not deleted. */
  loadSources(ctx: PublishContext, ids: string[]): Promise<PublishRow[]>;
  /** All publishable ids of the source branch (used by "copy setup"). */
  listSourceIds(ctx: PublishContext): Promise<string[]>;
  /** Natural-key match in the target branch (name / sku / code ...), never fails on collisions. */
  findExisting(
    ctx: PublishContext,
    row: PublishRow,
    targetBranchId: string,
  ): Promise<string | null>;
  /** Is a previously published target row still alive in that branch? */
  exists(
    ctx: PublishContext,
    targetId: string,
    targetBranchId: string,
  ): Promise<boolean>;
  create(
    ctx: PublishContext,
    row: PublishRow,
    targetBranchId: string,
  ): Promise<string>;
  update(
    ctx: PublishContext,
    row: PublishRow,
    targetId: string,
    targetBranchId: string,
  ): Promise<void>;
  /** Optional hook after a run (cache invalidation). */
  afterPublish?(ctx: PublishContext): Promise<void>;
}

export interface PublishTargetResult {
  branch_id: string;
  branch_name: string;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: { source_id: string; message: string }[];
}

export interface PublishResult {
  entity_type: string;
  mode: PublishMode;
  source_count: number;
  results: PublishTargetResult[];
}

export interface PublicationRecord {
  target_id: string;
}
