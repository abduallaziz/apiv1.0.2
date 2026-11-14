import {
  IsString,
  IsNotEmpty,
  IsUUID,
  IsOptional,
  IsNumber,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreatePackagingLevelDto {
  @IsUUID()
  item_id: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  level_name: string;

  // Omit for the root/base level (the item's existing storage unit).
  // DB enforces exactly one root per item (uq_item_packaging_root) and
  // that a non-root level always has quantity_in_parent > 1 conceptually
  // meaningful data, not just > 0 — validated server-side too, below.
  @IsUUID()
  @IsOptional()
  parent_level_id?: string;

  @IsNumber()
  @Min(0.0001)
  @Max(1_000_000)
  @IsOptional()
  quantity_in_parent?: number;
}
