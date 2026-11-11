import { IsUUID } from 'class-validator';

export class AssignVariantAttributeDto {
  @IsUUID()
  item_variant_id: string;

  @IsUUID()
  item_attribute_id: string;

  @IsUUID()
  item_attribute_value_id: string;
}
