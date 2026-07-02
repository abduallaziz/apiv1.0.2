import { v4 as uuidv4 } from 'uuid';
import { RequestLogContext } from '../logger.interface';

export function createRequestContext(partial?: Partial<RequestLogContext>): RequestLogContext {
  return {
    requestId: partial?.requestId ?? uuidv4(),
    correlationId: partial?.correlationId ?? uuidv4(),
    tenantId: partial?.tenantId ?? 'system',
    userId: partial?.userId ?? 'anonymous',
    role: partial?.role ?? 'unknown',
    dbQueryCount: partial?.dbQueryCount ?? 0,
  };
}