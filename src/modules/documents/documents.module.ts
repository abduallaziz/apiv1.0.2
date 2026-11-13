import { Module } from '@nestjs/common';
import { PermissionsModule } from '../../core/permissions/permissions.module';
import { DocumentsController } from './documents.controller';
import { DocumentsEnabledGuard } from './documents-enabled.guard';
import { TemplatesService } from './templates.service';
import { AssetsController } from './assets.controller';
import { DocumentsStatusController } from './documents-status.controller';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';
import { GenerationController } from './generation.controller';
import { GenerationService } from './generation.service';
import { AssetsService } from './assets.service';
import { TemplateRenderService } from './template-render.service';
import { PdfRendererService } from '../shifts/report/pdf-renderer.service';

// Document Template Builder (docs/DESIGN_DOCUMENT_BUILDER.md). Phase 1: skeleton, migrations and
// permissions. Phase 2: template management. Phase 3: asset library. Phase 4: render engine. Phase 9: QR + public verification. Phase 10: issuing + approvals.
@Module({
  imports: [PermissionsModule],
  controllers: [
    DocumentsController,
    AssetsController,
    DocumentsStatusController,
    VerificationController,
    GenerationController,
  ],
  providers: [
    DocumentsEnabledGuard,
    TemplatesService,
    AssetsService,
    TemplateRenderService,
    PdfRendererService,
    VerificationService,
    GenerationService,
  ],
})
export class DocumentsModule {}
