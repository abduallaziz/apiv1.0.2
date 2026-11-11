import { IsString, IsNotEmpty, IsUUID } from 'class-validator';

export class CreateItemAttributeValueDto {
  @IsUUID()
  item_attribute_id: string;

  @IsString()
  @IsNotEmpty()
  value: string;
}
