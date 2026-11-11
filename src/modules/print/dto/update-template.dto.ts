import { IsObject, IsOptional, IsUUID } from 'class-validator';

export class UpdateTemplateDto {
  /** The complete template saved from the designer (validated strictly in the service). */
  @IsObject()
  template!: Record<string, unknown>;

  /** Omit to save the tenant default; set to save that branch's override. */
  @IsOptional()
  @IsUUID()
  branch_id?: string;
}

export class TemplateQueryDto {
  @IsOptional()
  @IsUUID()
  branch_id?: string;
}
