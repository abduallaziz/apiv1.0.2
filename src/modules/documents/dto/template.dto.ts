import {
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { DOCUMENT_TYPES } from '../document.types';
import type { DocumentType } from '../document.types';

const PAPERS = ['A4', 'A5', '80mm', '58mm'];
const ORIENTATIONS = ['portrait', 'landscape'];

export class CreateTemplateDto {
  @IsIn(DOCUMENT_TYPES)
  doc_type: DocumentType;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsIn(PAPERS)
  paper?: string;

  @IsOptional()
  @IsIn(ORIENTATIONS)
  orientation?: string;

  // Initial body. Structural validation of elements/bindings arrives with the editor phases.
  @IsOptional()
  @IsObject()
  body?: Record<string, unknown>;
}

export class UpdateTemplateDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsIn(PAPERS)
  paper?: string;

  @IsOptional()
  @IsIn(ORIENTATIONS)
  orientation?: string;

  @IsOptional()
  @IsObject()
  body?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

export class AssignTemplateDto {
  @IsIn(['tenant', 'branch'])
  scope: 'tenant' | 'branch';

  @IsOptional()
  @IsUUID()
  branch_id?: string;
}

export class PreviewDto {
  // Unsaved draft from the editor; when omitted the stored working draft is rendered.
  @IsOptional()
  @IsObject()
  body?: Record<string, unknown>;

  @IsOptional()
  @IsIn(PAPERS)
  paper?: string;

  @IsOptional()
  @IsIn(ORIENTATIONS)
  orientation?: string;

  @IsOptional()
  @IsIn(['ar', 'en'])
  lang?: 'ar' | 'en';

  @IsOptional()
  @IsBoolean()
  overlays?: boolean;
}
