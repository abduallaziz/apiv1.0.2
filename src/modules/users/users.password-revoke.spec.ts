import { UsersService } from './users.service';
import { TenantContext } from '../../core/tenant/tenant.context';

/**
 * T9 / AUTH_REVOKE_SESSIONS_ON_PASSWORD_CHANGE wiring in UsersService.update (mocked deps, no database).
 * The service always delegates to AuthService.revokeSessionsOnPasswordChange (which is itself a no-op while
 * the flag is off, covered in auth-hardening.regression.spec.ts); the user-facing contract tested here is WHICH
 * session is kept: the caller's own only when the caller changed their OWN password.
 */
const tenant = new TenantContext('tenant-a', null);

function build() {
  const repo = {
    update: jest.fn().mockResolvedValue({ data: {}, error: null }),
  };
  const authService = {
    revokeSessionsOnPasswordChange: jest.fn().mockResolvedValue(undefined),
    revokeAllSessionsForUser: jest.fn().mockResolvedValue(undefined),
  };
  const service = new UsersService(
    repo as never,
    { log: jest.fn().mockResolvedValue(undefined) } as never,
    {} as never,
    authService as never,
    {} as never,
    {} as never,
  );
  jest
    .spyOn(service, 'findOne')
    .mockResolvedValue({ id: 'u1', name: 'U', is_active: true, branch_id: null } as never);
  return { service, authService };
}

describe('UsersService.update password change', () => {
  it('own password change keeps the caller current session', async () => {
    const { service, authService } = build();
    await service.update('u1', { password: 'N3w-Passw0rd!' } as never, tenant, 'u1', 'sess-1');
    expect(authService.revokeSessionsOnPasswordChange).toHaveBeenCalledWith('u1', 'sess-1');
  });

  it('an admin resetting ANOTHER user keeps nothing (the admin session is not the target user session)', async () => {
    const { service, authService } = build();
    await service.update('u1', { password: 'N3w-Passw0rd!' } as never, tenant, 'admin-1', 'sess-admin');
    expect(authService.revokeSessionsOnPasswordChange).toHaveBeenCalledWith('u1', undefined);
  });

  it('an update without a password never touches sessions', async () => {
    const { service, authService } = build();
    await service.update('u1', { name: 'X' } as never, tenant, 'u1', 'sess-1');
    expect(authService.revokeSessionsOnPasswordChange).not.toHaveBeenCalled();
  });
});
