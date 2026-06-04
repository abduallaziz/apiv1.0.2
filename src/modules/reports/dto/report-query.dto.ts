import { IsOptional, IsString, IsEnum, IsDateString } from 'class-validator';

export enum ReportPeriod {
  TODAY = 'today',
  WEEK = 'week',
  MONTH = 'month',
  CUSTOM = 'custom',
}

export enum ExportFormat {
  JSON = 'json',
  EXCEL = 'excel',
}

export class ReportQueryDto {
  @IsOptional()
  @IsEnum(ReportPeriod)
  period?: ReportPeriod = ReportPeriod.MONTH;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsString()
  branch_id?: string;

  @IsOptional()
  @IsEnum(ExportFormat)
  format?: ExportFormat = ExportFormat.JSON;
}