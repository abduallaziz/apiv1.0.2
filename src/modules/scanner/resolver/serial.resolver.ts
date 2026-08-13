import { Injectable } from '@nestjs/common';
import { SerialsRepository } from '../../inventory/repositories/serials.repository';
import {
  IResolver,
  ResolverContext,
  ResolverOutcome,
  ResolverSource,
} from './resolver.types';

// Priority 4. Reuses the existing SerialsRepository.findByNumber, which
// already returns an array for exactly this reason (serial_number is only
// unique per item, not tenant-wide).
@Injectable()
export class SerialResolver implements IResolver {
  readonly source: ResolverSource = 'item_serials';

  constructor(private readonly serialsRepo: SerialsRepository) {}

  async resolve(
    normalizedValue: string,
    context: ResolverContext,
  ): Promise<ResolverOutcome> {
    const matches = await this.serialsRepo.findByNumber(
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

    const serial = matches[0] as {
      id: string;
      item_id: string;
      variant_id: string | null;
      serial_number: string;
      status: string;
      items: { name: string; sku: string | null } | null;
      item_variants: { name: string; sku: string | null } | null;
    };

    return {
      status: 'match',
      entityType: 'serial',
      entityId: serial.id,
      displayInformation: {
        serial_number: serial.serial_number,
        item_id: serial.item_id,
        item_name: serial.items?.name ?? null,
        variant_id: serial.variant_id,
        variant_name: serial.item_variants?.name ?? null,
        status: serial.status,
      },
      // "Disabled/inactive" for a serial means its lifecycle status, not
      // an is_active flag (item_serials has no such column) — a scrapped
      // serial still resolves (identity is still real), it is just flagged.
      metadata: { is_active: serial.status !== 'scrapped' },
    };
  }
}
