/**
 * SecretsProvider — abstraction layer للتوسع المستقبلي.
 *
 * اليوم: RailwaySecretsProvider (process.env)
 * المستقبل: DopplerProvider / VaultProvider / AwsSecretsManagerProvider
 * بدون تعديل أي كود خارج هذا الملف.
 */
export interface SecretsProvider {
  get(key: string): string | undefined;
  getOrThrow(key: string): string;
}

export const SECRETS_PROVIDER = 'SECRETS_PROVIDER';