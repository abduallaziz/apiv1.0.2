import { Injectable } from '@nestjs/common';
import { SecretsProvider } from '../secrets.provider.interface';

/**
 * RailwaySecretsProvider
 *
 * يقرأ من process.env (Railway Variables في production، .env في development).
 * عند التحول لـ Doppler أو Vault: أنشئ provider جديد يطبق SecretsProvider
 * وبدّل التسجيل في SecretsModule فقط.
 */
@Injectable()
export class RailwaySecretsProvider implements SecretsProvider {
  get(key: string): string | undefined {
    return process.env[key];
  }

  getOrThrow(key: string): string {
    const value = process.env[key];
    if (!value) {
      throw new Error(
        `[SecretsProvider] Missing required secret: "${key}". ` +
        `Check .env or Railway Variables.`,
      );
    }
    return value;
  }
}