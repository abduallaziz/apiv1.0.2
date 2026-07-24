import { IsEnum } from 'class-validator';
import { HeldOrderVisibility } from './hold-order.dto';

export class UpdateHeldVisibilityDto {
  @IsEnum(HeldOrderVisibility)
  held_visibility: HeldOrderVisibility;
}
