import {
  IsArray,
  IsNumber,
  Min,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CreateScrapDto } from './create-scrap.dto';

export class CompleteProductionOrderDto {
  @IsNumber()
  @Min(0.0001)
  @IsOptional()
  quantity_produced?: number;

  // Optional — when provided, each entry is posted via
  // fn_record_production_scrap immediately after fn_post_production_order
  // succeeds (Migration 13.16A). Completely absent for every existing
  // caller, which is a no-op: the completion flow is byte-for-byte
  // unchanged when this is omitted.
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateScrapDto)
  @IsOptional()
  scrap?: CreateScrapDto[];
}
