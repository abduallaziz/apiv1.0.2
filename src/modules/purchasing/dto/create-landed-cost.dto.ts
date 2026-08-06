import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export enum LandedCostType {
  SHIPPING = 'shipping',
  CUSTOMS = 'customs',
  INSURANCE = 'insurance',
  OTHER = 'other',
}

export enum LandedCostAllocationMethod {
  BY_VALUE = 'by_value',
  BY_QUANTITY = 'by_quantity',
}

export class CreateLandedCostDto {
  @IsEnum(LandedCostType)
  cost_type: LandedCostType;

  @IsNumber()
  @Min(0)
  amount: number;

  @IsEnum(LandedCostAllocationMethod)
  @IsOptional()
  allocation_method?: LandedCostAllocationMethod;

  @IsString()
  @IsOptional()
  notes?: string;
}
