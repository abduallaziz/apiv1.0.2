import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateProductionOrderDto } from './create-production-order.dto';

// Identity fields (warehouse_id, bom_id) are fixed at creation — matches
// UpdateBomDto's restriction on item_id/variant_id. Only editable while the
// order is still 'draft' (enforced in the service, not here).
export class UpdateProductionOrderDto extends PartialType(
  OmitType(CreateProductionOrderDto, ['warehouse_id', 'bom_id'] as const),
) {}
