import { IsBoolean, IsOptional } from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';
import { CreateNotePresetDto } from './create-note-preset.dto';

export class UpdateNotePresetDto extends PartialType(CreateNotePresetDto) {
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
