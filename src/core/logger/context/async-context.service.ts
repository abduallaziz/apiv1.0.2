import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';
import { RequestLogContext } from '../logger.interface';

@Injectable()
export class AsyncContextService {
  private readonly storage = new AsyncLocalStorage<RequestLogContext>();

  run(context: RequestLogContext, callback: () => void): void {
    this.storage.run(context, callback);
  }

  get(): RequestLogContext | undefined {
    return this.storage.getStore();
  }

  set(key: Exclude<keyof RequestLogContext, 'dbQueryCount'>, value: string): void {
    const store = this.storage.getStore();
    if (store) {
      store[key] = value;
    }
  }

  incrementDbQueryCount(): void {
    const store = this.storage.getStore();
    if (store) {
      store.dbQueryCount += 1;
    }
  }
}