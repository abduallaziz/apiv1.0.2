import { Global, Module } from '@nestjs/common';
import { AsyncContextService } from './context/async-context.service';
import { LoggerService } from './logger.service';
import { LoggingInterceptor } from './interceptors/logging.interceptor';
import { GlobalExceptionFilter } from './filters/global-exception.filter';

@Global()
@Module({
  providers: [
    AsyncContextService,
    LoggerService,
    LoggingInterceptor,
    GlobalExceptionFilter,
  ],
  exports: [
    AsyncContextService,
    LoggerService,
    LoggingInterceptor,
    GlobalExceptionFilter,
  ],
})
export class LoggerModule {}