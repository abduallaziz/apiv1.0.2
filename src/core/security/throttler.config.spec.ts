import { ExecutionContext } from '@nestjs/common';
import { createThrottlers } from './throttler.config';

// The credential-guessing 'auth' tier (10/min) must bound ONLY the auth routes.
// NestJS applies every named tier to every route unless skipped, and it used to
// cap all business APIs (e.g. the POS shift poll) at 10/min for non-exempt tenants.
describe('createThrottlers - auth tier scope', () => {
  const authTier = createThrottlers({} as never).find((t) => t.name === 'auth');

  const ctxFor = (name: string) =>
    ({ getClass: () => ({ name }) }) as unknown as ExecutionContext;

  it('has a skipIf and keeps the 10/min limit', () => {
    expect(authTier).toBeDefined();
    expect(authTier!.limit).toBe(10);
    expect(typeof authTier!.skipIf).toBe('function');
  });

  it('applies to AuthController', () => {
    expect(authTier!.skipIf!(ctxFor('AuthController'))).toBe(false);
  });

  it('is skipped for business controllers', () => {
    expect(authTier!.skipIf!(ctxFor('ShiftsController'))).toBe(true);
    expect(authTier!.skipIf!(ctxFor('InvoicesController'))).toBe(true);
  });
});
