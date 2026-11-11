import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateItemAttributeValueDto } from './create-item-attribute-value.dto';

// item_attribute_id is fixed at creation, same rationale as
// UpdateItemBarcodeDto omitting item_id — a value isn't reassigned to a
// different attribute definition via update.
export class UpdateItemAttributeValueDto extends PartialType(
  OmitType(CreateItemAttributeValueDto, ['item_attribute_id'] as const),
) {}
