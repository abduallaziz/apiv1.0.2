import { BadRequestException } from '@nestjs/common';
import { TablesService } from './tables.service';
import { TenantContext } from '../../core/tenant/tenant.context';

function build() {
  const repo = {
    findAll: jest.fn().mockResolvedValue([]),
    findById: jest.fn().mockResolvedValue(null),
    branchBelongsToTenant: jest.fn().mockResolvedValue(true),
    create: jest.fn(),
  };
  return { service: new TablesService(repo as never), repo };
}

describe('TablesService branch isolation', () => {
  it('lists only the working branch when isolated', async () => {
    const { service, repo } = build();
    await service.findAll(new TenantContext('t1', 'b2', true), 'b9');
    expect(repo.findAll).toHaveBeenCalledWith('t1', 'b2');
  });

  it('passes the branch to the detail lookup (another branch -> not found)', async () => {
    const { service, repo } = build();
    await expect(service.findOne('x', new TenantContext('t1', 'b2', true))).rejects.toThrow();
    expect(repo.findById).toHaveBeenCalledWith('x', 't1', 'b2');
  });

  it('rejects creating a table in another branch', async () => {
    const { service, repo } = build();
    await expect(
      service.create(new TenantContext('t1', 'b2', true), { branch_id: 'b9', name: 'T1' } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.create).not.toHaveBeenCalled();
  });
});
