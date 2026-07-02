import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RevokeSessionDto } from './dto/revoke-session.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { JwtPayload } from '../../shared/types/jwt-payload.type';

const REFRESH_COOKIE = 'sefay_refresh';
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'none' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  path: '/',
};

@Controller('auth')
@Throttle({ auth: { limit: 10, ttl: 60000 } })
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ip = (req.headers['x-forwarded-for'] as string) || req.ip || '';
    const userAgent = req.headers['user-agent'] || '';
    const result = await this.authService.login(dto, ip, userAgent);

    res.cookie(REFRESH_COOKIE, result.refresh_token, COOKIE_OPTIONS);

    return {
      access_token: result.access_token,
      user: result.user,
    };
  }

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ip = (req.headers['x-forwarded-for'] as string) || req.ip || '';
    const userAgent = req.headers['user-agent'] || '';
    const result = await this.authService.register(dto, ip, userAgent);

    res.cookie(REFRESH_COOKIE, result.refresh_token, COOKIE_OPTIONS);

    return {
      access_token: result.access_token,
      user: result.user,
    };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ip = (req.headers['x-forwarded-for'] as string) || req.ip || '';
    const userAgent = req.headers['user-agent'] || '';
    const refreshToken = req.cookies?.[REFRESH_COOKIE];

    if (!refreshToken) {
      res.status(401).json({ message: 'No refresh token' });
      return;
    }

    const result = await this.authService.refresh(
      { refresh_token: refreshToken },
      ip,
      userAgent,
    );

    res.cookie(REFRESH_COOKIE, result.refresh_token, COOKIE_OPTIONS);

    return { access_token: result.access_token };
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = req.user as JwtPayload;
    const ip = (req.headers['x-forwarded-for'] as string) || req.ip || '';
    const ua = req.headers['user-agent'] || '';

    res.clearCookie(REFRESH_COOKIE, { path: '/' });

    return this.authService.logout(
      user.sub,
      user.session_id,
      ip,
      ua,
      user.role,
      user.tenant_id,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: Request) {
    const user = req.user as JwtPayload;
    return this.authService.me(user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Get('sessions')
  getSessions(@Req() req: Request) {
    const user = req.user as JwtPayload;
    return this.authService.getSessions(user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Post('revoke-session')
  @HttpCode(HttpStatus.OK)
  revokeSession(@Body() dto: RevokeSessionDto, @Req() req: Request) {
    const user = req.user as JwtPayload;
    const ip = (req.headers['x-forwarded-for'] as string) || req.ip || '';
    const ua = req.headers['user-agent'] || '';
    return this.authService.revokeSession(
      dto,
      user.sub,
      user.role,
      user.tenant_id,
      ip,
      ua,
    );
  }
}