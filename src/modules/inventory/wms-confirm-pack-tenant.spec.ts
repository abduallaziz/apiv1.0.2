import { NotFoundException } from '@nestjs/common';
import { WmsService } from './wms.service';

describe('WmsService.confirmPack tenant ownership (P1 isolation)', () => {
  const mk = (owned: boolean) => {
    const wmsRepo = {
      shipmentLineBelongsToTenant: jest.fn().mockResolvedValue(owned),
      confirmPack: jest.fn().mockResolvedValue({ ok: true }),
    };
    const svc = Object.create(WmsService.prototype) as WmsService;
    (svc as unknown as { wmsRepo: unknown }).wmsRepo = wmsRepo;
    return { svc, wmsRepo };
  };

  it('rejects a shipment line of another tenant before calling the RPC', async () => {
    const { svc, wmsRepo } = mk(false);
    await expect(svc.confirmPack('line-x', 'tenant-a', 1, 'u1')).rejects.toThrow(
      NotFoundException,
    );
    expect(wmsRepo.shipmentLineBelongsToTenant).toHaveBeenCalledWith('line-x', 'tenant-a');
    expect(wmsRepo.confirmPack).not.toHaveBeenCalled();
  });

  it('passes through for an owned line', async () => {
    const { svc, wmsRepo } = mk(true);
    await expect(svc.confirmPack('line-1', 'tenant-a', 2, 'u1')).resolves.toEqual({ ok: true });
    expect(wmsRepo.confirmPack).toHaveBeenCalledWith('line-1', 2, 'u1');
  });
});
