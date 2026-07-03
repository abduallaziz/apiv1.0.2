import { Controller, Get, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import { SuperAdminGuard } from '../guards/superadmin.guard';
import { Audit } from '../../../core/audit/audit.decorator';
import { AuthControlService } from '../services/auth-control.service';
import { ResetPasswordDto } from '../dto/reset-password.dto';
import { ChangeRoleDto } from '../dto/change-role.dto';
import { ToggleActiveDto } from '../dto/toggle-active.dto';

@Controller('superadmin')
@UseGuards(JwtAuthGuard, SuperAdminGuard)
export class AuthControlController {
  constructor(private readonly authControlService: AuthControlService) {}

  @Get('tenants/:tenantId/users')
  getTenantUsers(@Param('tenantId') tenantId: string) {
    return this.authControlService.getTenantUsers(tenantId);
  }

  @Patch('users/:id/reset-password')
  @Audit('user.reset_password')
  resetPassword(@Param('id') id: string, @Body() dto: ResetPasswordDto) {
    return this.authControlService.resetPassword(id, dto.newPassword);
  }

  @Patch('users/:id/role')
  @Audit('user.change_role')
  changeRole(@Param('id') id: string, @Body() dto: ChangeRoleDto) {
    return this.authControlService.changeRole(id, dto.role);
  }

  @Patch('users/:id/active')
  @Audit('user.toggle_active')
  toggleActive(@Param('id') id: string, @Body() dto: ToggleActiveDto) {
    return this.authControlService.toggleActive(id, dto.is_active);
  }

  @Patch('users/:id/revoke-sessions')
  @Audit('user.revoke_all_sessions')
  revokeAllUserSessions(@Param('id') id: string) {
    return this.authControlService.revokeAllUserSessions(id);
  }

  @Get('sessions')
  getSessions(@Query('tenantId') tenantId?: string, @Query('userId') userId?: string) {
    return this.authControlService.getSessions({ tenantId, userId });
  }

  @Patch('sessions/:id/revoke')
  @Audit('session.revoke')
  revokeSession(@Param('id') id: string) {
    return this.authControlService.revokeSession(id);
  }
}
