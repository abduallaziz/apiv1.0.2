import * as jwt from 'jsonwebtoken';
import { JwtPayload } from '../../shared/types/jwt-payload.type';

/**
 * Decodes (does NOT verify) the bearer token to read tenant_id for rate-limit
 * bucketing. This never grants access or trust — JwtAuthGuard independently
 * verifies the signature afterward and rejects invalid/forged tokens before
 * any business logic runs. A forged token here can only ever misattribute
 * its own request's rate-limit accounting, never bypass authentication.
 */
export function decodeTenantId(req: Record<string, unknown>): string | undefined {
  const headers = req['headers'] as Record<string, string> | undefined;
  const authHeader = headers?.['authorization'];
  if (!authHeader?.startsWith('Bearer ')) return undefined;
  try {
    const decoded = jwt.decode(authHeader.slice(7)) as JwtPayload | null;
    return decoded?.tenant_id;
  } catch {
    return undefined;
  }
}
