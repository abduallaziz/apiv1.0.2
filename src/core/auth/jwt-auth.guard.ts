import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { IS_PUBLIC_KEY } from '../../shared/decorators/public.decorator';
import { JwtPayload } from '../../shared/types/jwt-payload.type';
import * as jwt from 'jsonwebtoken';

@Injectable()
export class JwtAuthGuard {
  private readonly jwtSecret: string;

  constructor(
    private reflector: Reflector,
    private configService: ConfigService,
  ) {
    this.jwtSecret = this.configService.getOrThrow<string>('JWT_SECRET');
  }

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Invalid or missing token');
    }

    const token = authHeader.split(' ')[1];

    try {
      const payload = jwt.verify(token, this.jwtSecret) as JwtPayload;
      request.user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or missing token');
    }
  }
}