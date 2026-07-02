import { IsUUID, IsEnum, IsOptional } from 'class-validator';
import { BillingCycle } from '../../../core/billing/billing.types';

export class CreateSubscriptionDto {
  @IsUUID()
  plan_id: string;

  @IsOptional()
  @IsEnum(BillingCycle)
  billing_cycle?: BillingCycle;
}