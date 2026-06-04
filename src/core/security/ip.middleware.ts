import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class IpMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      const ip = Array.isArray(forwarded)
        ? forwarded[0]
        : forwarded.split(',')[0].trim();
      req['realIp'] = ip;
    } else {
      req['realIp'] = req.socket?.remoteAddress ?? 'unknown';
    }
    next();
  }
}