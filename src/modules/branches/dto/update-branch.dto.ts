import { IsString, IsOptional, IsBoolean, IsUUID, IsNumber, Min, MaxLength } from 'class-validator';

export class UpdateBranchDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  // Which warehouse POS sales at this branch deduct inventory from. null clears it
  // (branch reverts to not deducting inventory on sale — see migration 043).
  @IsOptional()
  @IsUUID()
  default_warehouse_id?: string | null;

  // Attendance geofence — center + radius in meters. All three null disables geofencing
  // for this branch (attendance check-ins are allowed from anywhere).
  @IsOptional()
  @IsNumber()
  geofence_lat?: number | null;

  @IsOptional()
  @IsNumber()
  geofence_lng?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(1)
  geofence_radius_m?: number | null;
}