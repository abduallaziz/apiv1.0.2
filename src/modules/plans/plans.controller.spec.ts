import { SuperAdminGuard } from '../superadmin/guards/superadmin.guard';
import { PlansController } from './plans.controller';

const guardsOf = (fn: unknown): unknown[] =>
  Reflect.getMetadata('__guards__', fn as object) ?? [];

describe('PlansController authorization (T1)', () => {
  const proto = PlansController.prototype;

  it.each(['create', 'update', 'remove'] as const)(
    '%s is superadmin-only',
    (m) => {
      expect(guardsOf(proto[m])).toContain(SuperAdminGuard);
    },
  );

  it.each(['findAll', 'findOne'] as const)(
    '%s is not superadmin-only (read access stays)',
    (m) => {
      expect(guardsOf(proto[m])).not.toContain(SuperAdminGuard);
    },
  );

  describe('read visibility', () => {
    const svc = { findAll: jest.fn(), findOne: jest.fn() };
    const ctrl = new PlansController(svc as never);
    const req = (u: object) => ({ user: u }) as never;
    beforeEach(() => jest.clearAllMocks());

    it('hides inactive plans from a normal user', () => {
      ctrl.findAll(req({ role: 'cashier', roles: ['cashier'] }));
      ctrl.findOne('x', req({ role: 'owner' }));
      expect(svc.findAll).toHaveBeenCalledWith(false);
      expect(svc.findOne).toHaveBeenCalledWith('x', false);
    });
    it('lets a superadmin see inactive plans', () => {
      ctrl.findAll(req({ role: 'superadmin', roles: ['superadmin'] }));
      ctrl.findOne('x', req({ roles: ['superadmin'] }));
      expect(svc.findAll).toHaveBeenCalledWith(true);
      expect(svc.findOne).toHaveBeenCalledWith('x', true);
    });
  });
});

describe('SuperAdminGuard rejects non-superadmin', () => {
  const g = new SuperAdminGuard();
  const c = (user: unknown) =>
    ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as never;
  it.each(['cashier', 'owner'])('%s -> 403', (role) => {
    expect(() => g.canActivate(c({ role, roles: [role] }))).toThrow();
  });
  it('superadmin passes', () => {
    expect(g.canActivate(c({ roles: ['superadmin'] }))).toBe(true);
  });
});
