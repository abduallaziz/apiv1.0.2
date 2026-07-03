import { Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { AttendanceRepository } from './repositories/attendance.repository';
import { SchedulesController } from './schedules.controller';
import { SchedulesService } from './schedules.service';
import { SchedulesRepository } from './repositories/schedules.repository';
import { PermissionsModule } from '../../core/permissions/permissions.module';
import { CoreAuthModule } from '../../core/auth/auth.module';

@Module({
  imports: [PermissionsModule, CoreAuthModule],
  controllers: [AttendanceController, SchedulesController],
  providers: [AttendanceService, AttendanceRepository, SchedulesService, SchedulesRepository],
})
export class HrModule {}
