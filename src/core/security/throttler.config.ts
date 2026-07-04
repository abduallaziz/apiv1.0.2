import { ThrottlerModuleOptions } from '@nestjs/throttler';

export const throttlerConfig: ThrottlerModuleOptions = {
  throttlers: [
    {
      // A multi-user dashboard (owner + manager + several cashiers navigating
      // simultaneously, each page firing several parallel queries, plus the
      // dashboard's own background polling) realistically exceeds 300 req/min per
      // tenant — 300 was still hit in production on plain single-user actions
      // (e.g. a Settings save) even after the dashboard's polling intervals were
      // widened, so raising further rather than treating this as fully solved.
      name: 'global',
      ttl: 60000,
      limit: 600,
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
