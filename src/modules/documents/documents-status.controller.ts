import { Controller, Get, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';

// Lets the web app hide the Document Builder nav entry while DOCUMENTS_BUILDER_ENABLED is off.
// Deliberately NOT behind DocumentsEnabledGuard; it only reports the flag, nothing else.
@Controller('documents')
@UseGuards(JwtAuthGuard, TenantGuard)
export class DocumentsStatusController {
  constructor(private readonly config: ConfigService) {}

  @Get('enabled')
  enabled() {
    return {
      enabled: this.config.get<boolean>('DOCUMENTS_BUILDER_ENABLED') === true,
    };
  }
}
