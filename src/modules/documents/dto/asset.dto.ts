import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { DocumentAssetCategory } from '../document.types';

export const ASSET_CATEGORIES: DocumentAssetCategory[] = [
  'company_stamp',
  'branch_stamp',
  'department_stamp',
  'signature',
  'logo',
  'image',
  'qr_config',
];

// Categories whose use is sensitive: stamps and signatures.
export const SENSITIVE_ASSET_CATEGORIES: DocumentAssetCategory[] = [
  'company_stamp',
  'branch_stamp',
  'department_stamp',
  'signature',
];

// multipart/form-data fields arrive as strings.
export class CreateAssetDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @IsIn(ASSET_CATEGORIES)
  category: DocumentAssetCategory;

  @IsOptional()
  @IsUUID()
  branch_id?: string;
}

export class UpdateAssetDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsIn(['active', 'archived'])
  status?: 'active' | 'archived';
}

export class AssetPermissionDto {
  @IsOptional()
  @IsUUID()
  role_id?: string;

  @IsOptional()
  @IsUUID()
  branch_id?: string;

  @IsOptional()
  @IsBoolean()
  can_use?: boolean;
}
