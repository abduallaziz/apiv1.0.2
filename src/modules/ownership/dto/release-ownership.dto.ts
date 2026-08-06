import { IsOptional, IsString } from 'class-validator';

export class ReleaseOwnershipDto {
  @IsString()
  @IsOptional()
  reason?: string;
}
