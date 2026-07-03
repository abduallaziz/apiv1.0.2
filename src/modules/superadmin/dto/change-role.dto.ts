import { IsIn } from 'class-validator';

export class ChangeRoleDto {
  @IsIn(['owner', 'manager', 'cashier', 'worker', 'inventory_clerk'])
  role: string;
}
