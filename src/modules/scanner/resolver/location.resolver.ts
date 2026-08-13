import { Injectable } from '@nestjs/common';
import { LocationsRepository } from '../../inventory/repositories/locations.repository';
import {
  IResolver,
  ResolverContext,
  ResolverOutcome,
  ResolverSource,
} from './resolver.types';

// Priority 2. Reuses LocationsRepository.findByCode (added in this phase
// to the existing WMS repository rather than duplicating it here).
@Injectable()
export class LocationResolver implements IResolver {
  readonly source: ResolverSource = 'warehouse_locations';

  constructor(private readonly locationsRepo: LocationsRepository) {}

  async resolve(
    normalizedValue: string,
    context: ResolverContext,
  ): Promise<ResolverOutcome> {
    let matches = await this.locationsRepo.findByCode(
      normalizedValue,
      context.tenantId,
    );

    // code is only unique per-warehouse, so the same code can exist in
    // more than one warehouse — a warehouse hint (if the caller has one,
    // e.g. the device's assigned_warehouse_id) disambiguates without
    // widening the match set.
    if (matches.length > 1 && context.warehouseId) {
      const scoped = matches.filter(
        (m: { warehouse_id: string }) => m.warehouse_id === context.warehouseId,
      );
      if (scoped.length > 0) matches = scoped;
    }

    if (matches.length === 0) return { status: 'no_match' };
    if (matches.length > 1) {
      return {
        status: 'ambiguous',
        candidateIds: matches.map((m: { id: string }) => m.id),
      };
    }

    const location = matches[0] as {
      id: string;
      code: string;
      name: string;
      zone: string | null;
      is_active: boolean;
      warehouse_id: string;
      warehouses: { id: string; name: string } | null;
    };

    return {
      status: 'match',
      entityType: 'location',
      entityId: location.id,
      displayInformation: {
        code: location.code,
        name: location.name,
        zone: location.zone,
        warehouse_id: location.warehouse_id,
        warehouse_name: location.warehouses?.name ?? null,
      },
      metadata: { is_active: location.is_active },
    };
  }
}
