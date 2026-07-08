import { IsInt, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateLoyaltyTierDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsNumber()
  @Min(0)
  min_lifetime_points: number;

  @IsNumber()
  @Min(0.01)
  points_multiplier: number;

  @IsOptional()
  @IsInt()
  sort_order?: number;
}
