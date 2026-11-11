import { IsIn } from 'class-validator';

export class ChangeWashStatusDto {
  @IsIn(['washing', 'ready', 'delivered', 'cancelled'])
  status: 'washing' | 'ready' | 'delivered' | 'cancelled';
}
