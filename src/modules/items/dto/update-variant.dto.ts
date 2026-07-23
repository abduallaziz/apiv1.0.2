import { PartialType } from '@nestjs/mapped-types';
import { CreateVariantDto } from './create-variant.dto';
import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateVariantDto extends PartialType(CreateVariantDto) {
  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}
