import { IsUUID, IsString, IsNotEmpty, IsIn, IsOptional } from 'class-validator';

export class CreateNonConformanceDto {
  @IsUUID()
  quality_inspection_id: string;

  @IsUUID()
  item_id: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsIn(['minor', 'major', 'critical'])
  @IsOptional()
  severity?: 'minor' | 'major' | 'critical';
}
