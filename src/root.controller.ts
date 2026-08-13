import { Controller, Get } from '@nestjs/common';

@Controller()
export class RootController {
  @Get()
  root(): { message: string; docs: string } {
    return {
      message:
        'Sefay API — this is a backend-only service, there is no page here. All routes are under /api/v1/*.',
      docs: '/api/v1',
    };
  }
}
