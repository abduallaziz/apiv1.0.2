import { ConflictException } from '@nestjs/common';
import { NotePresetsService } from './note-presets.service';

describe('NotePresetsService guards', () => {
  const tenant = { tenantId: 't1' } as never;
  const mk = (existing: { id: string; text: string }[]) => {
    const repo = {
      findAll: jest.fn().mockResolvedValue(existing),
      maxSortOrder: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockImplementation((_t, d) => Promise.resolve(d)),
      findById: jest.fn().mockResolvedValue({ id: 'p1' }),
      update: jest.fn().mockImplementation((_t, _i, d) => Promise.resolve(d)),
    };
    return { svc: new NotePresetsService(repo as never), repo };
  };

  it('rejects a duplicate (case/space-insensitive)', async () => {
    const { svc } = mk([{ id: 'a', text: 'No onion' }]);
    await expect(
      svc.create(tenant, { text: '  no   ONION ' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('stores English digits and trimmed text', async () => {
    const { svc, repo } = mk([]);
    await svc.create(tenant, { text: ' طاولة ١٢٣ ' });
    expect(repo.create).toHaveBeenCalledWith(
      tenant,
      expect.objectContaining({ text: 'طاولة 123' }),
    );
  });

  it('allows re-saving the same text on the same preset', async () => {
    const { svc } = mk([{ id: 'p1', text: 'Extra sauce' }]);
    await expect(
      svc.update(tenant, 'p1', { text: 'Extra sauce' }),
    ).resolves.toBeDefined();
  });
});
