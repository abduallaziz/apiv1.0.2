import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreatePackagingLevelDto } from './create-packaging-level.dto';

// item_id is fixed at creation, and parent_level_id is not reassignable via
// update (re-parenting could silently change every downstream conversion
// factor for existing barcodes already pointed at this level) — deleting
// and recreating is the safe path for a hierarchy restructure.
export class UpdatePackagingLevelDto extends PartialType(
  OmitType(CreatePackagingLevelDto, ['item_id', 'parent_level_id'] as const),
) {}
