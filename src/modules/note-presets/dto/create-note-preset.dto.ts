import {
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateNotePresetDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  text: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sort_order?: number;
}
