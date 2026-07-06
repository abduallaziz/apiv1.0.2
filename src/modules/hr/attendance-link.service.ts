import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { UsersRepository } from '../users/users.repository';
import { AttendanceRepository } from './repositories/attendance.repository';
import { EmployeeGeofencesRepository } from './repositories/employee-geofences.repository';
import { GeofenceService } from '../../shared/geo/geofence.service';

@Injectable()
export class AttendanceLinkService {
  constructor(
    private readonly usersRepo: UsersRepository,
    private readonly attendanceRepo: AttendanceRepository,
    private readonly employeeGeofencesRepo: EmployeeGeofencesRepository,
    private readonly geofence: GeofenceService,
  ) {}

  async getStatus(token: string) {
    const user = await this.usersRepo.findByAttendanceToken(token);
    if (!user) throw new NotFoundException('Invalid attendance link');

    const [today, zones] = await Promise.all([
      this.attendanceRepo.findTodayRecord(user.tenant_id, user.id),
      this.employeeGeofencesRepo.findAllForUser(user.tenant_id, user.id),
    ]);

    return {
      name: user.name,
      job_title: user.job_title ?? null,
      checked_in: !!today && !today.check_out_at,
      today_check_in_at: today?.check_in_at ?? null,
      today_check_out_at: today?.check_out_at ?? null,
      zone_name: zones[0]?.name ?? null,
    };
  }

  async check(token: string, lat: number, lng: number, deviceFingerprint: string) {
    const user = await this.usersRepo.findByAttendanceToken(token);
    if (!user) throw new NotFoundException('Invalid attendance link');

    if (user.attendance_device_fingerprint && user.attendance_device_fingerprint !== deviceFingerprint) {
      throw new ForbiddenException(
        'This link is registered to a different device. Ask your manager to unbind it if you got a new phone.',
      );
    }
    if (!user.attendance_device_fingerprint) {
      await this.usersRepo.bindAttendanceDevice(user.id, deviceFingerprint);
    }

    const geo = await this.geofence.checkLocation(user.tenant_id, user.id, lat, lng);
    if (!geo.allowed) {
      throw new BadRequestException('You must be at your work location to check in or out.');
    }

    const code = randomBytes(3).toString('hex').toUpperCase();
    const open = await this.attendanceRepo.findOpenRecord(user.tenant_id, user.id);

    if (open) {
      await this.attendanceRepo.checkOut(user.tenant_id, open.id, { lat, lng, code });
      return { action: 'check_out' as const, code, time: new Date().toISOString() };
    }

    await this.attendanceRepo.checkIn(user.tenant_id, user.id, null, { lat, lng, code });
    return { action: 'check_in' as const, code, time: new Date().toISOString() };
  }
}
