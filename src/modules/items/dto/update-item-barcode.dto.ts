import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateItemBarcodeDto } from './create-item-barcode.dto';

// item_id is fixed at creation — a barcode isn't reassigned to a different
// item via update, it would be deleted and recreated instead.
export class UpdateItemBarcodeDto extends PartialType(
  OmitType(CreateItemBarcodeDto, ['item_id'] as const),
) {}
