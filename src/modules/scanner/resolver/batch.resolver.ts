import { Injectable } from '@nestjs/common';
import { BatchesLookupRepository } from './repositories/batches-lookup.repository';
import {
  IResolver,
  ResolverContext,
  ResolverOutcome,
  ResolverSource,
} from './resolver.types';

// Priority 3.
@Injectable()
export class BatchResolver implements IResolver {
  readonly source: ResolverSource = 'item_batches';

  constructor(private readonly batchesRepo: BatchesLookupRepository) {}

  async resolve(
    normalizedValue: string,
    context: ResolverContext,
  ): Promise<ResolverOutcome> {
    const matches = await this.batchesRepo.findByBatchNumber(
      normalizedValue,
      context.tenantId,
    );
    if (matches.length === 0) return { status: 'no_match' };
    if (matches.length > 1) {
      return {
        status: 'ambiguous',
        candidateIds: matches.map((m: { id: string }) => m.id),
      };
    }

    const batch = matches[0] as unknown as {
      id: string;
      item_id: string;
      variant_id: string | null;
      batch_number: string;
      expiration_date: string | null;
      items: { id: string; name: string; is_active: boolean } | null;
      item_variants: { id: string; name: string; is_active: boolean } | null;
    };

    return {
      status: 'match',
      entityType: 'batch',
      entityId: batch.id,
      displayInformation: {
        batch_number: batch.batch_number,
        item_id: batch.item_id,
        item_name: batch.items?.name ?? null,
        variant_id: batch.variant_id,
        variant_name: batch.item_variants?.name ?? null,
        expiration_date: batch.expiration_date,
      },
      metadata: {
        is_active:
          (batch.items?.is_active ?? true) &&
          (batch.item_variants?.is_active ?? true),
      },
    };
  }
}
