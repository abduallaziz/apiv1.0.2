import { ThrottlerModuleOptions } from '@nestjs/throttler';

export const throttlerConfig: ThrottlerModuleOptions = {
  throttlers: [
    {
      name: 'global',
      ttl: 60000,
      limit: 100,
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
