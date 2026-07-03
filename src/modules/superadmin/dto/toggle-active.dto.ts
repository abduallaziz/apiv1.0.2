import { IsBoolean } from 'class-validator';

export class ToggleActiveDto {
  @IsBoolean()
  is_active: boolean;
}
