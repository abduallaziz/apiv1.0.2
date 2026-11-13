import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { DOCUMENT_TYPES } from '../document.types';
import type { DocumentType } from '../document.types';

export class ManualItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;

  @IsNumber()
  @Min(0.0001)
  @Max(1_000_000)
  quantity: number;

  @IsNumber()
  @Min(0)
  @Max(1_000_000_000)
  unit_price: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1_000_000_000)
  discount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  sku?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;
}

// Staff-entered data for documents that have no source record yet (quotation, voucher ...).
// The server computes every line total, VAT and the grand total from these inputs.
export class ManualInputDto {
  @IsOptional()
  @IsObject()
  customer?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  document?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  payment?: Record<string, unknown>;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ManualItemDto)
  items: ManualItemDto[];
}

export class IssueDocumentDto {
  @IsIn(DOCUMENT_TYPES)
  doc_type: DocumentType;

  // sale id for invoices/receipts; a free reference (max 64 chars) for manual documents
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  source_id: string;

  @IsOptional()
  @IsUUID()
  template_id?: string;

  @IsOptional()
  @IsIn(['ar', 'en'])
  lang?: 'ar' | 'en';

  @IsOptional()
  @ValidateNested()
  @Type(() => ManualInputDto)
  input?: ManualInputDto;
}

export class CreateApprovalDto {
  @IsUUID()
  template_id: string;

  @IsIn(['approved', 'rejected'])
  decision: 'approved' | 'rejected';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class VoidDocumentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason: string;
}
