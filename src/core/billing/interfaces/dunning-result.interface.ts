export interface DunningResult {
  tenantId: string;
  subscriptionId: string;
  attemptNumber: number;
  status: 'succeeded' | 'failed' | 'exhausted';
  nextRetryAt?: Date;
  errorMessage?: string;
}