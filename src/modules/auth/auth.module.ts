import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuditModule } from '../../core/audit/audit.module';
import { EmailLoginThrottleGuard } from '../../core/security/email-login-throttle.guard';

@Module({
  imports: [AuditModule],
  controllers: [AuthController],
  providers: [AuthService, EmailLoginThrottleGuard],
  exports: [AuthService],
})
export class AuthModule {}
