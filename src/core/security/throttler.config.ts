import { ThrottlerModuleOptions } from '@nestjs/throttler';

export const throttlerConfig: ThrottlerModuleOptions = {
  throttlers: [
    {
      name: 'global',
      ttl: 60000,
      limit: 100,
    },
  ],
};