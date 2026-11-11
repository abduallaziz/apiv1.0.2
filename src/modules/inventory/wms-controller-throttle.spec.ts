// Inventory #7 / F2 throttler audit — regression guard for the
// @SkipThrottle({auth:true}) fix on WmsController. Without this, every WMS
// route silently inherits the 10-req/60s credential-guessing 'auth' bucket
// (see wms.controller.ts's decorator comment and STATUS.md §3240-3245 for
// the identical bug previously found and fixed on refresh/logout). This
// asserts the metadata directly rather than re-deriving the 429 behavior
// end-to-end (already covered structurally by load-test-mode.spec.ts for
// TenantThrottlerGuard itself).
import 'reflect-metadata';
import { WmsController } from './wms.controller';

const THROTTLER_SKIP = 'THROTTLER:SKIP';

describe('WmsController throttling (Inventory #7 / F2)', () => {
  it('is exempted from the auth-tier (credential-guessing) throttle bucket', () => {
    const skipAuth = Reflect.getMetadata(`${THROTTLER_SKIP}auth`, WmsController);
    expect(skipAuth).toBe(true);
  });

  it('does NOT skip the general business-API throttle tiers (global/global-ip/session stay active)', () => {
    expect(Reflect.getMetadata(`${THROTTLER_SKIP}global`, WmsController)).not.toBe(true);
    expect(Reflect.getMetadata(`${THROTTLER_SKIP}global-ip`, WmsController)).not.toBe(true);
    expect(Reflect.getMetadata(`${THROTTLER_SKIP}session`, WmsController)).not.toBe(true);
  });
});
