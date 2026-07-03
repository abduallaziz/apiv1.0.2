import { IsUUID, IsIn, IsNumber, Min, IsOptional, IsString } from 'class-validator';

export class ManualPaymentDto {
  @IsUUID()
  tenant_id: string;

  @IsUUID()
  plan_id: string;

  @IsIn(['monthly', 'yearly'])
  billing_cycle: 'monthly' | 'yearly';

  @IsNumber()
  @Min(1)
  amount: number;

  @IsOptional()
  @IsString()
  note?: string;
}
