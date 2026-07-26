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
  IsDateString,
  IsIn,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AgreementLineDto {
  @IsUUID()
  item_id: string;

  @IsUUID()
  @IsOptional()
  variant_id?: string;

  @IsNumber()
  @Min(0.0001)
  @IsOptional()
  committed_quantity?: number;

  @IsNumber()
  @Min(0.0001)
  @IsOptional()
  committed_value?: number;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class CreateAgreementDto {
  @IsUUID()
  supplier_id: string;

  @IsString()
  @IsNotEmpty()
  agreement_number: string;

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

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AgreementLineDto)
  items: AgreementLineDto[];
}
