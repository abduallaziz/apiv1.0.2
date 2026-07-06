import { Controller, Get, Post, Param, Body, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { AttendanceLinkService } from './attendance-link.service';
import { AttendanceCheckDto } from './dto/attendance-check.dto';

// Deliberately unauthenticated — this is the personal punch-in/out link an employee opens
// on their own phone. Identity comes from the unguessable token in the URL; the geofence
// check (see GeofenceService) and per-device binding (see AttendanceLinkService) are what
// actually gate the action, not a login session.
@Controller('attend')
export class AttendanceLinkController {
  constructor(private readonly service: AttendanceLinkService) {}

  @Get(':token')
  getStatus(@Param('token') token: string) {
    return this.service.getStatus(token);
  }

  @Post(':token')
  @HttpCode(HttpStatus.OK)
  check(@Param('token') token: string, @Body() dto: AttendanceCheckDto) {
    return this.service.check(token, dto.lat, dto.lng, dto.device_fingerprint);
  }

  @Get(':token/dashboard')
  getDashboard(@Param('token') token: string) {
    return this.service.getDashboard(token);
  }

  @Get(':token/log')
  getLog(
    @Param('token') token: string,
    @Query('range') range: 'day' | 'week' | 'month' = 'week',
    @Query('date') date?: string,
  ) {
    return this.service.getLog(token, range, date ?? new Date().toISOString().substring(0, 10));
  }
}
