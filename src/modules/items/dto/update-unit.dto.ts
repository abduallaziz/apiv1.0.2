import { PartialType } from '@nestjs/mapped-types';
import { CreateUnitDto } from './create-unit.dto';
import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateUnitDto extends PartialType(CreateUnitDto) {
  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}
