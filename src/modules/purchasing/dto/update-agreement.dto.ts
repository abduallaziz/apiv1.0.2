import {
  IsString,
  IsOptional,
  IsDateString,
  IsIn,
  IsBoolean,
} from 'class-validator';

export class UpdateAgreementDto {
  @IsString()
  @IsOptional()
  currency?: string;

  @IsDateString()
  @IsOptional()
  effective_date?: string;

  @IsDateString()
  @IsOptional()
  expiration_date?: string;

  @IsBoolean()
  @IsOptional()
  auto_expire?: boolean;

  @IsIn(['block', 'warn', 'require_approval', 'allow'])
  @IsOptional()
  overage_policy?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
