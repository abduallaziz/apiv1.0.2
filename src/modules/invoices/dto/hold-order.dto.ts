import {
  IsString,
  IsNotEmpty,
  IsUUID,
  IsOptional,
  IsNumber,
  Min,
  IsArray,
  ValidateNested,
  IsEnum,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum HeldOrderVisibility {
  SELF = 'self',
  ALL_CASHIERS = 'all_cashiers',
}

export class HoldOrderItemDto {
  @IsUUID()
  item_id: string;

  @IsString()
  @IsNotEmpty()
  item_name: string;

  @IsUUID()
  @IsOptional()
  variant_id?: string;

  @IsString()
  @IsOptional()
  variant_name?: string;

  @IsNumber()
  @Min(1)
  quantity: number;

  @IsNumber()
  @Min(0)
  unit_price: number;
}

export class HoldOrderDto {
  @IsUUID()
  branch_id: string;

  @IsUUID()
  @IsOptional()
  shift_id?: string;

  @IsUUID()
  @IsOptional()
  customer_id?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => HoldOrderItemDto)
  items: HoldOrderItemDto[];

  @IsString()
  @IsOptional()
  notes?: string;

  @IsEnum(HeldOrderVisibility)
  @IsOptional()
  held_visibility?: HeldOrderVisibility;
}
