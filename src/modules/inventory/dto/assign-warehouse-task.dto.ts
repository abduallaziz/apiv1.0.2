import { IsUUID } from 'class-validator';

export class AssignWarehouseTaskDto {
  @IsUUID()
  assigned_to: string;
}
