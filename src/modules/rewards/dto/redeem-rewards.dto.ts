import { ArrayMinSize, ArrayUnique, IsArray, IsUUID } from 'class-validator';

export class RedeemRewardsPreviewDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  instance_ids: string[];
}
