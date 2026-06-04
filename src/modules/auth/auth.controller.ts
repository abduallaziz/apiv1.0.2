import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RevokeSessionDto } from './dto/revoke-session.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { JwtPayload } from '../../shared/types/jwt-payload.type';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto, @Req() req: Request) {
    const ip = (req.headers['x-forwarded-for'] as string) || req.ip || '';
    const userAgent = req.headers['user-agent'] || '';
    return this.authService.login(dto, ip, userAgent);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    const ip = (req.headers['x-forwarded-for'] as string) || req.ip || '';
    const userAgent = req.headers['user-agent'] || '';
    return this.authService.refresh(dto, ip, userAgent);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Req() req: Request) {
    const user = req.user as JwtPayload;
    const ip = (req.headers['x-forwarded-for'] as string) || req.ip || '';
    const ua = req.headers['user-agent'] || '';
    return this.authService.logout(user.sub, user.session_id, ip, ua, user.role, user.tenant_id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: Request) {
    const user = req.user as JwtPayload;
    return this.authService.me(user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Post('revoke-session')
  @HttpCode(HttpStatus.OK)
  revokeSession(@Body() dto: RevokeSessionDto, @Req() req: Request) {
    const user = req.user as JwtPayload;
    const ip = (req.headers['x-forwarded-for'] as string) || req.ip || '';
    const ua = req.headers['user-agent'] || '';
    return this.authService.revokeSession(dto, user.sub, user.role, user.tenant_id, ip, ua);
  }
}