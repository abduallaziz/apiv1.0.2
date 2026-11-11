import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient } from '@supabase/supabase-js';
import { StorageService } from './storage.service';

function buildSupabaseMock(overrides: {
  uploadError?: { message: string } | null;
  signError?: { message: string } | null;
  signedUrl?: string;
}) {
  const upload = jest.fn().mockResolvedValue({
    error: overrides.uploadError ?? null,
  });
  const createSignedUrl = jest.fn().mockResolvedValue({
    data: overrides.signError
      ? null
      : { signedUrl: overrides.signedUrl ?? 'https://signed.example/file' },
    error: overrides.signError ?? null,
  });

  const from = jest.fn().mockReturnValue({ upload, createSignedUrl });

  const supabase = { storage: { from } } as unknown as SupabaseClient;

  return { supabase, upload, createSignedUrl, from };
}

function buildConfig(bucket = 'private-attachments') {
  return { get: jest.fn().mockReturnValue(bucket) } as unknown as ConfigService;
}

describe('StorageService', () => {
  const baseInput = {
    tenantId: 'tenant-1',
    ownerType: 'expense',
    ownerId: 'owner-1',
    uploadedBy: 'user-1',
    fileName: 'receipt.pdf',
    fileType: 'application/pdf',
    fileBuffer: Buffer.from('hello'),
  };

  it('generates a tenant-scoped, owner-scoped storage path', async () => {
    const mock = buildSupabaseMock({});
    const service = new StorageService(mock.supabase, buildConfig());

    const result = await service.upload(baseInput);

    expect(result.storagePath.startsWith('tenant-1/expense/owner-1/')).toBe(
      true,
    );
    expect(result.storagePath.endsWith('receipt.pdf')).toBe(true);
  });

  it('propagates uploader/tenant/owner metadata into the upload call and result', async () => {
    const mock = buildSupabaseMock({});
    const service = new StorageService(mock.supabase, buildConfig());

    const result = await service.upload(baseInput);

    expect(mock.from).toHaveBeenCalledWith('private-attachments');
    expect(mock.upload).toHaveBeenCalledWith(
      expect.stringContaining('tenant-1/expense/owner-1/'),
      baseInput.fileBuffer,
      { contentType: 'application/pdf', upsert: false },
    );
    expect(result.fileType).toBe('application/pdf');
  });

  it('honors the upload contract shape: {fileUrl, fileType, storagePath}', async () => {
    const mock = buildSupabaseMock({ signedUrl: 'https://signed.example/x' });
    const service = new StorageService(mock.supabase, buildConfig());

    const result = await service.upload(baseInput);

    expect(result.fileUrl).toBe('https://signed.example/x');
    expect(result.fileType).toBe('application/pdf');
    expect(typeof result.storagePath).toBe('string');
  });

  it('is private by default — retrieval always goes through a signed URL, never a public one', async () => {
    const mock = buildSupabaseMock({ signedUrl: 'https://signed.example/y' });
    const service = new StorageService(mock.supabase, buildConfig());

    await service.upload(baseInput);

    expect(mock.createSignedUrl).toHaveBeenCalled();
  });

  it('getSignedUrl returns a temporary signed URL for a known storage path', async () => {
    const mock = buildSupabaseMock({ signedUrl: 'https://signed.example/z' });
    const service = new StorageService(mock.supabase, buildConfig());

    const url = await service.getSignedUrl('tenant-1/expense/owner-1/f.pdf');

    expect(url).toBe('https://signed.example/z');
    expect(mock.createSignedUrl).toHaveBeenCalledWith(
      'tenant-1/expense/owner-1/f.pdf',
      3600,
    );
  });

  it('rejects upload input missing tenantId/ownerType/ownerId', async () => {
    const mock = buildSupabaseMock({});
    const service = new StorageService(mock.supabase, buildConfig());

    await expect(
      service.upload({ ...baseInput, tenantId: '' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects upload input with an empty file buffer', async () => {
    const mock = buildSupabaseMock({});
    const service = new StorageService(mock.supabase, buildConfig());

    await expect(
      service.upload({ ...baseInput, fileBuffer: Buffer.alloc(0) }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects getSignedUrl called with an empty storagePath', async () => {
    const mock = buildSupabaseMock({});
    const service = new StorageService(mock.supabase, buildConfig());

    await expect(service.getSignedUrl('')).rejects.toThrow(BadRequestException);
  });

  it('surfaces a clean error when the underlying upload fails', async () => {
    const mock = buildSupabaseMock({ uploadError: { message: 'boom' } });
    const service = new StorageService(mock.supabase, buildConfig());

    await expect(service.upload(baseInput)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('sanitizes a caller-supplied filename to prevent path traversal', async () => {
    const mock = buildSupabaseMock({});
    const service = new StorageService(mock.supabase, buildConfig());

    const result = await service.upload({
      ...baseInput,
      fileName: '../../etc/passwd',
    });

    expect(result.storagePath).not.toContain('..');
    expect(result.storagePath.endsWith('passwd')).toBe(true);
  });
});
