import { IsOptional, IsDateString, IsEnum } from 'class-validator';

export enum AnalyticsPeriod {
  LAST_30_DAYS = '30d',
  LAST_90_DAYS = '90d',
  LAST_6_MONTHS = '6m',
  LAST_12_MONTHS = '12m',
  YEAR_TO_DATE = 'ytd',
}

export class AnalyticsQueryDto {
  @IsOptional()
  @IsEnum(AnalyticsPeriod)
  period?: AnalyticsPeriod = AnalyticsPeriod.LAST_12_MONTHS;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}