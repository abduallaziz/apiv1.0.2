import { Injectable } from '@nestjs/common';
import { ItemBarcodesRepository } from '../../items/repositories/item-barcodes.repository';
import {
  IResolver,
  ResolverContext,
  ResolverOutcome,
  ResolverSource,
} from './resolver.types';

// Priority 1. Reuses the existing item_barcodes master data and its
// existing repository (ItemBarcodesRepository.lookupByBarcode) rather than
// querying the table again here — barcode is tenant-wide unique, so this
// can never be ambiguous.
@Injectable()
export class ItemBarcodeResolver implements IResolver {
  readonly source: ResolverSource = 'item_barcodes';

  constructor(private readonly barcodesRepo: ItemBarcodesRepository) {}

  async resolve(
    normalizedValue: string,
    context: ResolverContext,
  ): Promise<ResolverOutcome> {
    // item_barcodes.barcode is stored as originally entered (mixed case
    // possible for QR-type codes); try the normalized value first since
    // that is what most real barcodes (EAN/UPC, numeric) look like after
    // uppercasing, then fall back to the raw-cased normalized value's
    // lowercase form is NOT attempted — barcode identity is a database
    // concern, not a normalization concern, so no guessing beyond the one
    // normalized form the Event Engine already produced.
    const match = await this.barcodesRepo.lookupByBarcode(
      normalizedValue,
      context.tenantId,
    );
    if (!match) return { status: 'no_match' };

    const item = match.items as unknown as {
      id: string;
      name: string;
      is_active: boolean;
    } | null;
    const variant = match.variant_id
      ? (match.item_variants as unknown as {
          id: string;
          name: string;
          is_active: boolean;
        } | null)
      : null;

    if (variant) {
      return {
        status: 'match',
        entityType: 'variant',
        entityId: variant.id,
        displayInformation: {
          item_id: item?.id ?? null,
          item_name: item?.name ?? null,
          variant_name: variant.name,
          barcode: match.barcode,
          barcode_type: match.barcode_type,
        },
        metadata: { is_active: variant.is_active && (item?.is_active ?? true) },
      };
    }

    return {
      status: 'match',
      entityType: 'item',
      entityId: item?.id ?? match.item_id,
      displayInformation: {
        item_name: item?.name ?? null,
        barcode: match.barcode,
        barcode_type: match.barcode_type,
      },
      metadata: { is_active: item?.is_active ?? true },
    };
  }
}
