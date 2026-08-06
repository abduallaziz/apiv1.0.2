import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export enum SubcontractCostType {
  SERVICE_FEE = 'service_fee',
  SHIPPING = 'shipping',
  OTHER = 'other',
}

export class CreateSubcontractCostDto {
  @IsEnum(SubcontractCostType)
  cost_type: SubcontractCostType;

  @IsNumber()
  @Min(0)
  amount: number;

  @IsString()
  @IsOptional()
  notes?: string;
}
