import { Injectable } from '@nestjs/common';
import { ItemBarcodeResolver } from './item-barcode.resolver';
import { LocationResolver } from './location.resolver';
import { BatchResolver } from './batch.resolver';
import { SerialResolver } from './serial.resolver';
import { RfidResolver } from './rfid.resolver';
import { IResolver, ResolutionResult, ResolverContext } from './resolver.types';

// Resolver Engine pipeline (#21 Phase 5). Fixed priority order — do not
// reorder without a documented architectural reason, per the approved
// design: item_barcodes -> warehouse_locations.code ->
// item_batches.batch_number -> item_serials.serial_number -> RFID.
//
// Behavior: the first resolver to report a single unambiguous match wins
// and the pipeline stops there. A resolver reporting MULTIPLE matches
// stops the pipeline immediately too (as 'ambiguous') rather than falling
// through to the next resolver — an ambiguous hit is a real conflict on
// that identifier space, not an absence of one, and silently trying the
// next resolver would mask it. Only 'no_match' continues to the next
// resolver in priority order.
//
// This engine performs identification ONLY. It never modifies inventory,
// stock levels, cost layers, or executes any workflow (transfer/receive/
// pick/etc.) — see the resolvers themselves, which are all read-only.
@Injectable()
export class ResolverService {
  private readonly pipeline: IResolver[];

  constructor(
    itemBarcodeResolver: ItemBarcodeResolver,
    locationResolver: LocationResolver,
    batchResolver: BatchResolver,
    serialResolver: SerialResolver,
    rfidResolver: RfidResolver,
  ) {
    this.pipeline = [
      itemBarcodeResolver,
      locationResolver,
      batchResolver,
      serialResolver,
      rfidResolver,
    ];
  }

  async resolve(
    normalizedValue: string,
    context: ResolverContext,
  ): Promise<ResolutionResult> {
    if (!normalizedValue) {
      return this.notFound({ reason: 'empty_value' });
    }

    for (const resolver of this.pipeline) {
      const outcome = await resolver.resolve(normalizedValue, context);

      if (outcome.status === 'match') {
        return {
          status: 'matched',
          entity_type: outcome.entityType,
          entity_id: outcome.entityId,
          resolver_source: resolver.source,
          confidence_score: 1.0,
          display_information: outcome.displayInformation,
          resolution_metadata: {
            ...outcome.metadata,
            resolver_priority: this.pipeline.indexOf(resolver) + 1,
          },
        };
      }

      if (outcome.status === 'ambiguous') {
        return {
          status: 'ambiguous',
          entity_type: null,
          entity_id: null,
          resolver_source: resolver.source,
          confidence_score: 0,
          display_information: null,
          resolution_metadata: {
            reason: 'multiple_candidates',
            candidate_count: outcome.candidateIds.length,
            candidate_ids: outcome.candidateIds,
          },
        };
      }
      // 'no_match' — fall through to the next resolver in priority order
    }

    return this.notFound({ reason: 'no_resolver_matched' });
  }

  private notFound(metadata: Record<string, unknown>): ResolutionResult {
    return {
      status: 'not_found',
      entity_type: null,
      entity_id: null,
      resolver_source: null,
      confidence_score: 0,
      display_information: null,
      resolution_metadata: metadata,
    };
  }
}
