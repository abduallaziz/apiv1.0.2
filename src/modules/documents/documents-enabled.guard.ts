import { Injectable, CanActivate, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Document Template Builder stays unreachable until DOCUMENTS_BUILDER_ENABLED is flipped on (post
// Phase 11) — see docs/DESIGN_DOCUMENT_BUILDER.md §6. Unlike FeatureGuard (per-tenant/plan, DB-backed),
// this is a single boot-time env switch, the same pattern ZATCA_ENABLED uses.
@Injectable()
export class DocumentsEnabledGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(): boolean {
    if (this.config.get<boolean>('DOCUMENTS_BUILDER_ENABLED') !== true) {
      throw new ForbiddenException('Document Template Builder is not enabled');
    }
    return true;
  }
}
