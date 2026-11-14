import {
  IsString,
  IsOptional,
  IsNotEmpty,
  IsBoolean,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  IsNumber,
  Min,
  Max,
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { BranchProfileDto } from './branch-profile.dto';

export const WIZARD_COPY_TYPES = [
  'items',
  'categories',
  'brands',
  'units',
  'customer_field_definitions',
  'expense_categories_v2',
  'expense_departments',
  'shift_patterns',
  'loyalty_tiers',
  'coupons',
  'reward_definitions',
] as const;

/** Wizard step 5 option (b): copy the chosen groups from a source branch (isolation on, central users only). */
export class WizardCopyDto {
  @IsUUID()
  source_branch_id: string;

  @IsArray()
  @ArrayMaxSize(20)
  @IsIn(WIZARD_COPY_TYPES as unknown as string[], { each: true })
  entity_types: string[];
}

export class CreateBranchDto extends BranchProfileDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  /** Branch isolation only: copy the main branch's setup (categories, expense lookups, shift patterns...) to the new branch. */
  @IsOptional()
  @IsBoolean()
  copy_setup_from_main?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  geofence_lat?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  geofence_lng?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(1)
  geofence_radius_m?: number | null;

  /** Name of the branch's own first warehouse (default: "Warehouse - <branch>"). */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  warehouse_name?: string;

  /** Wizard: copy chosen entity groups from a source branch. */
  @IsOptional()
  @ValidateNested()
  @Type(() => WizardCopyDto)
  wizard_copy?: WizardCopyDto;
}
