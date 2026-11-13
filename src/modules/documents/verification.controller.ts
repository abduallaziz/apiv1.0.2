import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VerificationService } from './verification.service';

// Public (no auth) and read-only. Only whitelisted fields are returned; see VerificationService.
@Controller('public/verify')
export class VerificationController {
  constructor(
    private readonly verification: VerificationService,
    private readonly config: ConfigService,
  ) {}

  @Get(':token')
  verify(@Param('token') token: string) {
    // unreachable until the builder is switched on, exactly like the rest of the feature
    if (this.config.get<boolean>('DOCUMENTS_BUILDER_ENABLED') !== true) {
      throw new NotFoundException('Not found');
    }
    return this.verification.verify(token);
  }
}
