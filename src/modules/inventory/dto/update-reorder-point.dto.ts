import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateReorderPointDto } from './create-reorder-point.dto';
import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateReorderPointDto extends PartialType(
  OmitType(CreateReorderPointDto, ['warehouse_id', 'item_id', 'variant_id'] as const),
) {
  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}
