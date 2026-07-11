import { IsUUID } from 'class-validator';

// Unlike ChangeRoleDto (fixed UserRole enum — system roles only), this
// accepts any roles.id: a custom tenant role or a system role. Grants an
// additional role alongside whatever the user already holds, rather than
// replacing the primary one — see UsersService.addRole().
export class AddRoleDto {
  @IsUUID()
  role_id: string;
}
