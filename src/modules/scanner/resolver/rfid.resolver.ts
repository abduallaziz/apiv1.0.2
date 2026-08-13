import { Injectable } from '@nestjs/common';
import { RfidTagsRepository } from './repositories/rfid-tags.repository';
import {
  IResolver,
  ResolverContext,
  ResolverOutcome,
  ResolverSource,
} from './resolver.types';

// Priority 5. Future-compatible: no RFID hardware adapter exists yet
// (Phase 6), but the identity mapping is in place so the Resolver
// pipeline's shape does not need to change when it arrives.
@Injectable()
export class RfidResolver implements IResolver {
  readonly source: ResolverSource = 'item_rfid_tags';

  constructor(private readonly rfidRepo: RfidTagsRepository) {}

  async resolve(
    normalizedValue: string,
    context: ResolverContext,
  ): Promise<ResolverOutcome> {
    const matches = await this.rfidRepo.findByTagValue(
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

    const tag = matches[0] as unknown as {
      id: string;
      item_id: string;
      variant_id: string | null;
      tag_value: string;
      items: { name: string; is_active: boolean } | null;
      item_variants: { name: string; is_active: boolean } | null;
    };

    return {
      status: 'match',
      entityType: 'rfid',
      entityId: tag.id,
      displayInformation: {
        tag_value: tag.tag_value,
        item_id: tag.item_id,
        item_name: tag.items?.name ?? null,
        variant_id: tag.variant_id,
        variant_name: tag.item_variants?.name ?? null,
      },
      metadata: {
        is_active:
          (tag.items?.is_active ?? true) &&
          (tag.item_variants?.is_active ?? true),
      },
    };
  }
}
