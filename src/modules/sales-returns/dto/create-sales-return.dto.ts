import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class ReturnLineDto {
  @IsUUID()
  order_item_id: string;

  @IsInt()
  @Min(1)
  quantity: number;
}

export class CreateSalesReturnDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReturnLineDto)
  items: ReturnLineDto[];

  @IsString()
  @IsOptional()
  reason?: string;
}
