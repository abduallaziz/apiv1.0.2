import { Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { AttendanceRepository } from './repositories/attendance.repository';
import { AttendanceLinkController } from './attendance-link.controller';
import { AttendanceLinkService } from './attendance-link.service';
import { SchedulesController } from './schedules.controller';
import { SchedulesService } from './schedules.service';
import { SchedulesRepository } from './repositories/schedules.repository';
import { ShiftPatternsController } from './shift-patterns.controller';
import { ShiftPatternsService } from './shift-patterns.service';
import { ShiftPatternsRepository } from './repositories/shift-patterns.repository';
import { EmployeeGeofencesController } from './employee-geofences.controller';
import { EmployeeGeofencesService } from './employee-geofences.service';
import { EmployeeGeofencesRepository } from './repositories/employee-geofences.repository';
import { LeaveRequestsRepository } from './repositories/leave-requests.repository';
import { NotificationsRepository } from './repositories/notifications.repository';
import { PermissionsModule } from '../../core/permissions/permissions.module';
import { CoreAuthModule } from '../../core/auth/auth.module';
import { UsersModule } from '../users/users.module';
import { GeofenceService } from '../../shared/geo/geofence.service';

@Module({
  imports: [PermissionsModule, CoreAuthModule, UsersModule],
  controllers: [AttendanceController, AttendanceLinkController, SchedulesController, ShiftPatternsController, EmployeeGeofencesController],
  providers: [
    AttendanceService,
    AttendanceRepository,
    AttendanceLinkService,
    SchedulesService,
    SchedulesRepository,
    ShiftPatternsService,
    ShiftPatternsRepository,
    EmployeeGeofencesService,
    EmployeeGeofencesRepository,
    LeaveRequestsRepository,
    NotificationsRepository,
    GeofenceService,
  ],
})
export class HrModule {}
