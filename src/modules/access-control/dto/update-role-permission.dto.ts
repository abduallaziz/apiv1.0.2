import { IsBoolean } from 'class-validator';

export class UpdateRolePermissionDto {
  @IsBoolean()
  is_granted: boolean;
}
