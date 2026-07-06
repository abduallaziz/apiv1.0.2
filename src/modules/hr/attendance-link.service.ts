import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { UsersRepository } from '../users/users.repository';
import { AttendanceRepository } from './repositories/attendance.repository';
import { EmployeeGeofencesRepository } from './repositories/employee-geofences.repository';
import { LeaveRequestsRepository } from './repositories/leave-requests.repository';
import { NotificationsRepository } from './repositories/notifications.repository';
import { GeofenceService } from '../../shared/geo/geofence.service';

function todayStr() {
  return new Date().toISOString().substring(0, 10);
}

@Injectable()
export class AttendanceLinkService {
  constructor(
    private readonly usersRepo: UsersRepository,
    private readonly attendanceRepo: AttendanceRepository,
    private readonly employeeGeofencesRepo: EmployeeGeofencesRepository,
    private readonly leaveRequestsRepo: LeaveRequestsRepository,
    private readonly notificationsRepo: NotificationsRepository,
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

  async getDashboard(token: string) {
    const user = await this.usersRepo.findByAttendanceToken(token);
    if (!user) throw new NotFoundException('Invalid attendance link');

    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01T00:00:00.000Z`;
    const monthEnd = new Date().toISOString();

    const [today, monthRecords, leaveDaysUsed, recentLeaves, recentNotifications] = await Promise.all([
      this.attendanceRepo.findTodayRecord(user.tenant_id, user.id),
      this.attendanceRepo.findForRange(user.tenant_id, user.id, monthStart, monthEnd),
      this.leaveRequestsRepo.sumApprovedDaysThisYear(user.tenant_id, user.id),
      this.leaveRequestsRepo.findRecentForUser(user.tenant_id, user.id),
      this.notificationsRepo.findRecentForUser(user.tenant_id, user.id),
    ]);

    const workHoursToday = today
      ? today.check_out_at
        ? (new Date(today.check_out_at).getTime() - new Date(today.check_in_at).getTime()) / 3600000
        : (now.getTime() - new Date(today.check_in_at).getTime()) / 3600000
      : 0;

    const workDaysThisMonth = new Set(monthRecords.map((r) => r.check_in_at.substring(0, 10))).size;
    const monthlyHoursTotal = monthRecords.reduce((sum, r) => {
      if (r.hours_worked !== null) return sum + r.hours_worked;
      // still-open record (today) — count elapsed time so far
      return sum + (now.getTime() - new Date(r.check_in_at).getTime()) / 3600000;
    }, 0);

    return {
      name: user.name,
      job_title: user.job_title ?? null,
      checked_in: !!today && !today.check_out_at,
      work_hours_today: Math.round(workHoursToday * 100) / 100,
      work_days_this_month: workDaysThisMonth,
      monthly_hours_total: Math.round(monthlyHoursTotal * 100) / 100,
      leave_balance: user.annual_leave_balance !== null && user.annual_leave_balance !== undefined
        ? Math.max(0, user.annual_leave_balance - leaveDaysUsed)
        : null,
      recent_leaves: recentLeaves,
      recent_notifications: recentNotifications,
    };
  }

  async getLog(token: string, range: 'day' | 'week' | 'month', date: string) {
    const user = await this.usersRepo.findByAttendanceToken(token);
    if (!user) throw new NotFoundException('Invalid attendance link');

    const anchor = new Date(`${date}T00:00:00.000Z`);
    let from: Date;
    let to: Date;
    if (range === 'day') {
      from = anchor;
      to = new Date(anchor);
      to.setUTCDate(to.getUTCDate() + 1);
    } else if (range === 'week') {
      // Week starts Saturday, matching the reference (السبت first).
      const dow = anchor.getUTCDay(); // 0=Sun..6=Sat
      const daysSinceSaturday = (dow + 1) % 7;
      from = new Date(anchor);
      from.setUTCDate(from.getUTCDate() - daysSinceSaturday);
      to = new Date(from);
      to.setUTCDate(to.getUTCDate() + 7);
    } else {
      from = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
      to = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 1));
    }

    const records = await this.attendanceRepo.findForRange(
      user.tenant_id,
      user.id,
      from.toISOString(),
      to.toISOString(),
    );

    return {
      from: from.toISOString().substring(0, 10),
      to: new Date(to.getTime() - 86400000).toISOString().substring(0, 10),
      records,
    };
  }
}
