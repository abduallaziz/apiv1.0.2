import { ExecutionContext } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { isLoadTestMode } from './load-test-mode';
import { EmailLoginThrottleGuard } from './email-login-throttle.guard';
import { TenantThrottlerGuard } from './tenant-throttler.guard';

describe('LOAD_TEST_MODE', () => {
  const originalValue = process.env.LOAD_TEST_MODE;

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env.LOAD_TEST_MODE;
    } else {
      process.env.LOAD_TEST_MODE = originalValue;
    }
  });

  describe('isLoadTestMode()', () => {
    it('is off when the variable is unset — the production default', () => {
      delete process.env.LOAD_TEST_MODE;
      expect(isLoadTestMode()).toBe(false);
    });

    it('is on only for the exact string "true"', () => {
      process.env.LOAD_TEST_MODE = 'true';
      expect(isLoadTestMode()).toBe(true);
    });

    // Fails closed: anything that merely looks enabling leaves every limit
    // active. A typo must never silently disable rate limiting.
    it.each(['false', 'TRUE', 'True', '1', 'yes', 'on', '', ' true '])(
      'stays off for %p',
      (value) => {
        process.env.LOAD_TEST_MODE = value;
        expect(isLoadTestMode()).toBe(false);
      },
    );
  });

  describe('TenantThrottlerGuard', () => {
    // shouldSkip is protected; this exposes it without altering behaviour.
    class ProbeGuard extends TenantThrottlerGuard {
      public skip(context: ExecutionContext): Promise<boolean> {
        return this.shouldSkip(context);
      }
    }

    const guard = () =>
      new ProbeGuard(
        { throttlers: [] },
        {} as never,
        { getAllAndOverride: () => undefined } as never,
      );

    const contextFor = (headers: Record<string, string>): ExecutionContext =>
      ({
        switchToHttp: () => ({
          getRequest: () => ({ headers, path: '/items', realIp: '1.2.3.4' }),
        }),
      }) as unknown as ExecutionContext;

    it('does not skip an ordinary request when the flag is off', async () => {
      delete process.env.LOAD_TEST_MODE;
      await expect(guard().skip(contextFor({}))).resolves.toBe(false);
    });

    it('skips every request when the flag is on', async () => {
      process.env.LOAD_TEST_MODE = 'true';
      await expect(guard().skip(contextFor({}))).resolves.toBe(true);
    });

    // ThrottlerGuard.canActivate() evaluates shouldSkip() before iterating the
    // named throttlers, so skipping here covers 'global', 'global-ip', 'auth'
    // and 'session' in one place rather than four.
    it('short-circuits before any named throttler is consulted', async () => {
      process.env.LOAD_TEST_MODE = 'true';
      const probe = guard();
      const throttlersSpy = jest.fn();
      Object.defineProperty(probe, 'throttlers', {
        get: () => {
          throttlersSpy();
          return [];
        },
      });
      await expect(probe.skip(contextFor({}))).resolves.toBe(true);
      expect(throttlersSpy).not.toHaveBeenCalled();
    });
  });

  describe('EmailLoginThrottleGuard', () => {
    const contextFor = (email: string): ExecutionContext =>
      ({
        switchToHttp: () => ({ getRequest: () => ({ body: { email } }) }),
      }) as unknown as ExecutionContext;

    // Mimics the real per-email counter: INCR returns an ever-growing count,
    // and the guard throws once it passes 5 within the window.
    function redisStub() {
      const counts: Record<string, number> = {};
      return {
        incr: jest.fn((key: string) => {
          counts[key] = (counts[key] ?? 0) + 1;
          return Promise.resolve(counts[key]);
        }),
        pexpire: jest.fn(() => Promise.resolve(1)),
      };
    }

    it('still throttles after 5 attempts when the flag is off', async () => {
      delete process.env.LOAD_TEST_MODE;
      const redis = redisStub();
      const guard = new EmailLoginThrottleGuard(redis as never);
      const ctx = contextFor('victim@example.com');

      for (let i = 0; i < 5; i++) {
        await expect(guard.canActivate(ctx)).resolves.toBe(true);
      }
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        ThrottlerException,
      );
      expect(redis.incr).toHaveBeenCalledTimes(6);
    });

    it('bypasses the per-email limit when the flag is on', async () => {
      process.env.LOAD_TEST_MODE = 'true';
      const redis = redisStub();
      const guard = new EmailLoginThrottleGuard(redis as never);
      const ctx = contextFor('loadtest@example.com');

      for (let i = 0; i < 50; i++) {
        await expect(guard.canActivate(ctx)).resolves.toBe(true);
      }
      // The bypass returns before any Redis work — the counter is not just
      // ignored, it is never incremented, so unsetting the flag leaves a clean
      // window rather than a pre-exhausted one.
      expect(redis.incr).not.toHaveBeenCalled();
    });
  });
});
