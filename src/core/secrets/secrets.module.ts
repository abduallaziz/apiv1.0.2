import { Global, Module } from '@nestjs/common';
import { SecretsService } from './secrets.service';
import { RailwaySecretsProvider } from './providers/railway.provider';
import { SECRETS_PROVIDER } from './secrets.provider.interface';

/**
 * SecretsModule (Global)
 *
 * يُسجَّل مرة واحدة في AppModule.
 * لتغيير الـ provider مستقبلاً: بدّل RailwaySecretsProvider فقط.
 */
@Global()
@Module({
  providers: [
    {
      provide: SECRETS_PROVIDER,
      useClass: RailwaySecretsProvider,
    },
    SecretsService,
  ],
  exports: [SecretsService],
})
export class SecretsModule {}