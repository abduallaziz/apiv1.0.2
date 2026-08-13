import { IsIn, IsOptional, IsString } from 'class-validator';

// open -> investigating -> containment -> corrective_action -> verification -> closed
export class UpdateNonConformanceStatusDto {
  @IsIn(['investigating', 'containment', 'corrective_action', 'verification', 'closed'])
  status: 'investigating' | 'containment' | 'corrective_action' | 'verification' | 'closed';

  @IsString()
  @IsOptional()
  root_cause?: string;

  @IsString()
  @IsOptional()
  resolution_notes?: string;

  @IsString()
  @IsOptional()
  reason?: string;
}
