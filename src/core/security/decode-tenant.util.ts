import * as jwt from 'jsonwebtoken';
import { JwtPayload } from '../../shared/types/jwt-payload.type';

/**
 * Reads tenant_id from the bearer token for rate-limit bucketing/exemptions
 * and returns it ONLY if the token's signature verifies against JWT_SECRET.
 * An unsigned, forged, expired or otherwise invalid token yields undefined,
 * so the caller falls back to the per-IP bucket and can never gain a fresh
 * bucket or an exemption by inventing a tenant_id.
 */
export function decodeTenantId(
  req: Record<string, unknown>,
): string | undefined {
  const headers = req['headers'] as Record<string, string> | undefined;
  const authHeader = headers?.['authorization'];
  if (!authHeader?.startsWith('Bearer ')) return undefined;
  const secret = process.env.JWT_SECRET;
  if (!secret) return undefined;
  try {
    const verified = jwt.verify(authHeader.slice(7), secret) as JwtPayload;
    return verified?.tenant_id ?? undefined;
  } catch {
    return undefined;
  }
}
