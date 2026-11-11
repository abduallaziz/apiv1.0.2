import { IsUUID } from 'class-validator';

export class AssignPickListDto {
  @IsUUID()
  assigned_to: string;
}
