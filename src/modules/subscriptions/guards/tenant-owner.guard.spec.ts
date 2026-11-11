import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { TenantOwnerGuard } from './tenant-owner.guard';

const ctx = (user: unknown) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

describe('TenantOwnerGuard', () => {
  const guard = new TenantOwnerGuard();

  it('allows the owner (roles array)', () => {
    expect(guard.canActivate(ctx({ roles: ['owner'], role: 'owner' }))).toBe(
      true,
    );
  });
  it('allows the owner (legacy single role)', () => {
    expect(guard.canActivate(ctx({ role: 'owner' }))).toBe(true);
  });
  it('allows a superadmin', () => {
    expect(guard.canActivate(ctx({ roles: ['superadmin'] }))).toBe(true);
  });
  it.each(['cashier', 'manager', 'admin'])('rejects %s', (role) => {
    expect(() => guard.canActivate(ctx({ role, roles: [role] }))).toThrow(
      ForbiddenException,
    );
  });
  it('rejects when there is no user', () => {
    expect(() => guard.canActivate(ctx(undefined))).toThrow(ForbiddenException);
  });
});
