import { Injectable, Inject } from '@nestjs/common';
import { SECRETS_PROVIDER, SecretsProvider } from './secrets.provider.interface';

@Injectable()
export class SecretsService {
  constructor(
    @Inject(SECRETS_PROVIDER)
    private readonly provider: SecretsProvider,
  ) {}

  get(key: string): string | undefined {
    return this.provider.get(key);
  }

  getOrThrow(key: string): string {
    return this.provider.getOrThrow(key);
  }
}