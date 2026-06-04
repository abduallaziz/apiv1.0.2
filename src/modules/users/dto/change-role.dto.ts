import { IsEnum } from 'class-validator';
import { UserRole } from '../../../shared/types/enums';

export class ChangeRoleDto {
  @IsEnum(UserRole)
  role: UserRole;
}