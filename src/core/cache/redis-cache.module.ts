import { Module, Global, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { RedisCacheService } from './redis-cache.service';
import { REDIS_CLIENT } from './redis-client.token';

const redisLogger = new Logger('RedisCache');

export { REDIS_CLIENT };

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('REDIS_URL');
        const client = url ? new Redis(url) : new Redis();
        client.on('error', (err) => {
          redisLogger.error(`Redis connection error: ${err.message}`);
        });
        return client;
      },
    },
    RedisCacheService,
  ],
  exports: [RedisCacheService, REDIS_CLIENT],
})
export class RedisCacheModule {}
