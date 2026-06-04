import { Module } from '@nestjs/common';
import { ShiftsController } from './shifts.controller';
import { ShiftsService } from './shifts.service';
import { ShiftsRepository } from './shifts.repository';
import { ShiftEngineModule } from '../../engines/shift-engine/shift-engine.module';
import { PermissionsModule } from '../../core/permissions/permissions.module';

@Module({
  imports: [ShiftEngineModule, PermissionsModule],
  controllers: [ShiftsController],
  providers: [ShiftsService, ShiftsRepository],
  exports: [ShiftsService],
})
export class ShiftsModule {}