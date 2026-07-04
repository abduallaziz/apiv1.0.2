import { ThrottlerModuleOptions } from '@nestjs/throttler';

export const throttlerConfig: ThrottlerModuleOptions = {
  throttlers: [
    {
      // A multi-user dashboard (owner + manager + several cashiers navigating
      // simultaneously, each page firing several parallel queries) realistically
      // exceeds 100 req/min per tenant — raised after this was hit in real production use.
      name: 'global',
      ttl: 60000,
      limit: 300,
    },
    {
      // Tighter limit for authentication endpoints to slow credential stuffing
      name: 'auth',
      ttl: 60000,
      limit: 10,
    },
  ],
};

export const throttlers = throttlerConfig.throttlers;
