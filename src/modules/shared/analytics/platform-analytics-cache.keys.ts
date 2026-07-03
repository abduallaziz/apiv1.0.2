import { AnalyticsPeriod } from './dto/analytics-query.dto';

/** All standard periods pre-warmed hourly by PlatformAnalyticsProcessor. */
export const WARMED_USAGE_PERIODS: AnalyticsPeriod[] = [
  AnalyticsPeriod.LAST_30_DAYS,
  AnalyticsPeriod.LAST_90_DAYS,
  AnalyticsPeriod.LAST_6_MONTHS,
  AnalyticsPeriod.LAST_12_MONTHS,
  AnalyticsPeriod.YEAR_TO_DATE,
];

export const COHORT_ANALYSIS_CACHE_KEY = 'analytics:platform:cohort';

/** TTL for entries refreshed hourly by the cron — long enough to survive one missed cycle. */
export const WARMED_CACHE_TTL_SECONDS = 2 * 60 * 60;

/** TTL for cache-aside fallback entries (e.g. custom date ranges not pre-warmed). */
export const FALLBACK_CACHE_TTL_SECONDS = 60 * 60;

export function buildUsageAnalyticsCacheKey(
  period: AnalyticsPeriod,
  from?: string,
  to?: string,
): string {
  return `analytics:platform:usage:${period}:${from ?? ''}:${to ?? ''}`;
}
