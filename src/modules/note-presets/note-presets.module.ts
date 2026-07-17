import { Module } from '@nestjs/common';
import { NotePresetsController } from './note-presets.controller';
import { NotePresetsService } from './note-presets.service';
import { NotePresetsRepository } from './note-presets.repository';
import { PermissionsModule } from '../../core/permissions/permissions.module';
import { CoreAuthModule } from '../../core/auth/auth.module';

@Module({
  imports: [PermissionsModule, CoreAuthModule],
  controllers: [NotePresetsController],
  providers: [NotePresetsService, NotePresetsRepository],
  exports: [NotePresetsService],
})
export class NotePresetsModule {}
