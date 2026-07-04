import { Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { AttendanceRepository } from './repositories/attendance.repository';
import { AttendanceLinkController } from './attendance-link.controller';
import { AttendanceLinkService } from './attendance-link.service';
import { SchedulesController } from './schedules.controller';
import { SchedulesService } from './schedules.service';
import { SchedulesRepository } from './repositories/schedules.repository';
import { EmployeeGeofencesController } from './employee-geofences.controller';
import { EmployeeGeofencesService } from './employee-geofences.service';
import { EmployeeGeofencesRepository } from './repositories/employee-geofences.repository';
import { PermissionsModule } from '../../core/permissions/permissions.module';
import { CoreAuthModule } from '../../core/auth/auth.module';
import { UsersModule } from '../users/users.module';
import { GeofenceService } from '../../shared/geo/geofence.service';

@Module({
  imports: [PermissionsModule, CoreAuthModule, UsersModule],
  controllers: [AttendanceController, AttendanceLinkController, SchedulesController, EmployeeGeofencesController],
  providers: [
    AttendanceService,
    AttendanceRepository,
    AttendanceLinkService,
    SchedulesService,
    SchedulesRepository,
    EmployeeGeofencesService,
    EmployeeGeofencesRepository,
    GeofenceService,
  ],
})
export class HrModule {}
