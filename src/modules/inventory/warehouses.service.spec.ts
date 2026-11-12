import { BadRequestException } from '@nestjs/common';
import { WarehousesService } from './warehouses.service';

describe('WarehousesService.remove — default warehouse guard', () => {
  const build = (isDefault: boolean) => {
    const repo = {
      findById: jest.fn().mockResolvedValue({ id: 'w1' }),
      isBranchDefault: jest.fn().mockResolvedValue(isDefault),
      softDelete: jest.fn().mockResolvedValue(undefined),
    };
    return { service: new WarehousesService(repo as any), repo };
  };

  it('refuses to delete the default warehouse of a branch', async () => {
    const { service, repo } = build(true);
    await expect(service.remove('w1', 't1')).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.softDelete).not.toHaveBeenCalled();
  });

  it('deletes a warehouse that is not any branch default', async () => {
    const { service, repo } = build(false);
    await service.remove('w1', 't1');
    expect(repo.softDelete).toHaveBeenCalledWith('w1', 't1');
  });
});
