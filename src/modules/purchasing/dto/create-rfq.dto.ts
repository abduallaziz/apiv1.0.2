import {
  IsUUID,
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  Min,
  IsArray,
  ArrayMinSize,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class RfqLineDto {
  @IsUUID()
  item_id: string;

  @IsUUID()
  @IsOptional()
  variant_id?: string;

  @IsNumber()
  @Min(0.0001)
  quantity_requested: number;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class CreateRfqDto {
  @IsUUID()
  @IsOptional()
  branch_id?: string;

  @IsUUID()
  @IsOptional()
  warehouse_id?: string;

  @IsUUID()
  @IsOptional()
  source_pr_id?: string;

  @IsString()
  @IsNotEmpty()
  rfq_number: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RfqLineDto)
  items: RfqLineDto[];

  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  supplier_ids: string[];
}
