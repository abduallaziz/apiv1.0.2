// Resolver Engine (#21 Phase 5) — shared contracts.
//
// A resolver identifies WHAT a normalized scan value refers to. It never
// executes a workflow, never touches inventory/cost/stock, and never
// decides whether the caller is allowed to act on the result — that is
// the Action Framework's job (Phase 7), operating on this output.

export type ResolvedEntityType =
  | 'item'
  | 'variant'
  | 'location'
  | 'batch'
  | 'serial'
  | 'rfid';

export type ResolverSource =
  | 'item_barcodes'
  | 'warehouse_locations'
  | 'item_batches'
  | 'item_serials'
  | 'item_rfid_tags';

export interface ResolverContext {
  tenantId: string;
  // Optional hints a caller may supply to disambiguate a value that would
  // otherwise match more than one row (e.g. a location code that exists
  // in two warehouses). Purely a filter — never widens what a resolver
  // would otherwise match.
  warehouseId?: string;
}

// A resolver's own outcome, before the pipeline wraps it into the public
// ResolutionResult contract.
export type ResolverOutcome =
  | { status: 'no_match' }
  | { status: 'ambiguous'; candidateIds: string[] }
  | {
      status: 'match';
      entityType: ResolvedEntityType;
      entityId: string;
      displayInformation: Record<string, unknown>;
      metadata: Record<string, unknown>;
    };

export interface IResolver {
  readonly source: ResolverSource;
  resolve(
    normalizedValue: string,
    context: ResolverContext,
  ): Promise<ResolverOutcome>;
}

export type ResolutionStatus = 'matched' | 'not_found' | 'ambiguous';

export interface ResolutionResult {
  status: ResolutionStatus;
  entity_type: ResolvedEntityType | null;
  entity_id: string | null;
  resolver_source: ResolverSource | null;
  confidence_score: number;
  display_information: Record<string, unknown> | null;
  resolution_metadata: Record<string, unknown>;
}
