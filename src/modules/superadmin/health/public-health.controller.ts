import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class PublicHealthController {
  @Get()
  check() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}