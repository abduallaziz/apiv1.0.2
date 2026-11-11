import { IsUUID, ValidateIf } from 'class-validator';

export class AssignWashWorkerDto {
  // null clears the assignment.
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  worker_id: string | null;
}
