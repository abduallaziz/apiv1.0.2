import { IsBoolean, IsOptional } from 'class-validator';
import { PartialType, PickType } from '@nestjs/mapped-types';
import { CreateGiftCardDto } from './create-gift-card.dto';

export class UpdateGiftCardDto extends PartialType(
  PickType(CreateGiftCardDto, ['expires_at'] as const),
) {
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
