import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TenantContext } from '../../core/tenant/tenant.context';
import {
  assertBranchChangeAllowed,
  resolveNewStaffBranch,
} from './staff-branch.util';

const off = new TenantContext('t1', null, false);
const on = new TenantContext('t1', 'bA', true);

describe('resolveNewStaffBranch', () => {
  it('keeps legacy behaviour when isolation is off', () => {
    expect(resolveNewStaffBranch(off, 'cashier', undefined)).toBeNull();
    expect(resolveNewStaffBranch(off, 'cashier', 'bX')).toBe('bX');
  });
  it('defaults to the working branch under isolation', () => {
    expect(resolveNewStaffBranch(on, 'cashier', undefined)).toBe('bA');
    expect(resolveNewStaffBranch(on, 'none', 'bA')).toBe('bA');
  });
  it('rejects another branch under isolation', () => {
    expect(() => resolveNewStaffBranch(on, 'cashier', 'bB')).toThrow(
      BadRequestException,
    );
  });
  it('keeps owner central', () => {
    expect(resolveNewStaffBranch(on, 'owner', undefined)).toBeNull();
  });
});

describe('assertBranchChangeAllowed', () => {
  it('is a no-op when isolation is off or branch untouched', () => {
    expect(() =>
      assertBranchChangeAllowed(off, 'cashier', 'bA', null, false),
    ).not.toThrow();
    expect(() =>
      assertBranchChangeAllowed(on, 'cashier', 'bA', undefined, false),
    ).not.toThrow();
    expect(() =>
      assertBranchChangeAllowed(on, 'cashier', 'bA', 'bA', false),
    ).not.toThrow();
  });
  it('forbids unbranching an employee', () => {
    expect(() =>
      assertBranchChangeAllowed(on, 'cashier', 'bA', null, true),
    ).toThrow(BadRequestException);
  });
  it('only central actors can move staff', () => {
    expect(() =>
      assertBranchChangeAllowed(on, 'cashier', 'bA', 'bB', false),
    ).toThrow(ForbiddenException);
    expect(() =>
      assertBranchChangeAllowed(on, 'cashier', 'bA', 'bB', true),
    ).not.toThrow();
  });
});
