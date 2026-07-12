import { IsIn, IsString } from 'class-validator';

export class SetPermissionOverrideDto {
  @IsString()
  permission_key: string;

  @IsIn(['GRANT', 'DENY'])
  action: 'GRANT' | 'DENY';
}
