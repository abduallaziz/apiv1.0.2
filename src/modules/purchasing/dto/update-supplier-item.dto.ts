import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateSupplierItemDto } from './create-supplier-item.dto';

// item_id/variant_id define the row's identity (see uq_supplier_items_scope)
// — not editable in place, matching the UpdateBomDto/UpdateProductionOrderDto
// precedent of restricting identity fields on update.
export class UpdateSupplierItemDto extends PartialType(
  OmitType(CreateSupplierItemDto, ['item_id', 'variant_id'] as const),
) {}
