import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/supabase.module';
import { StorageUploadInput, StorageUploadResult } from './storage.types';

// Default signed-URL lifetime for getSignedUrl() when the caller doesn't
// specify one. Private-by-default: every file is uploaded non-public, and
// the only way to read one back is a time-limited signed URL.
const DEFAULT_SIGNED_URL_EXPIRY_SECONDS = 3600;

@Injectable()
export class StorageService {
  private readonly bucket: string;

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
    private readonly config: ConfigService,
  ) {
    // No bucket has been provisioned in the Supabase project yet (confirmed
    // absent this session — no storage.buckets seed, no config.toml in the
    // live project). SUPABASE_STORAGE_BUCKET must be set to a real,
    // already-created private bucket before any upload() call can succeed
    // at runtime; this only supplies the name, it does not create the
    // bucket.
    this.bucket = this.config.get<string>(
      'SUPABASE_STORAGE_BUCKET',
      'private-attachments',
    );
  }

  async upload(input: StorageUploadInput): Promise<StorageUploadResult> {
    if (!input.tenantId || !input.ownerType || !input.ownerId) {
      throw new BadRequestException(
        'Storage upload requires tenantId, ownerType, and ownerId',
      );
    }
    if (!input.fileBuffer || input.fileBuffer.length === 0) {
      throw new BadRequestException('Storage upload requires a non-empty file');
    }

    const safeFileName = sanitizeFileName(input.fileName);
    // A UUID prefix, not the raw uploaded filename alone, avoids collisions
    // between two uploads with the same original filename under the same
    // owner — the original name is preserved as a suffix for readability.
    const storagePath = `${input.tenantId}/${input.ownerType}/${input.ownerId}/${randomUUID()}-${safeFileName}`;

    const { error } = await this.supabase.storage
      .from(this.bucket)
      .upload(storagePath, input.fileBuffer, {
        contentType: input.fileType,
        upsert: false,
      });

    if (error) {
      throw new BadRequestException(`Storage upload failed: ${error.message}`);
    }

    const { data: signed, error: signError } = await this.supabase.storage
      .from(this.bucket)
      .createSignedUrl(storagePath, DEFAULT_SIGNED_URL_EXPIRY_SECONDS);

    if (signError || !signed) {
      throw new BadRequestException(
        `Storage upload succeeded but signing the retrieval URL failed: ${signError?.message}`,
      );
    }

    return {
      fileUrl: signed.signedUrl,
      fileType: input.fileType,
      storagePath,
    };
  }

  async getSignedUrl(
    storagePath: string,
    expiresInSeconds: number = DEFAULT_SIGNED_URL_EXPIRY_SECONDS,
  ): Promise<string> {
    if (!storagePath) {
      throw new BadRequestException('storagePath is required');
    }

    const { data, error } = await this.supabase.storage
      .from(this.bucket)
      .createSignedUrl(storagePath, expiresInSeconds);

    if (error || !data) {
      throw new BadRequestException(
        `Could not create a signed URL: ${error?.message}`,
      );
    }

    return data.signedUrl;
  }
}

// Strips path separators and any character outside a conservative safe set,
// so a caller-supplied filename can never be used to escape the intended
// {tenantId}/{ownerType}/{ownerId}/ prefix or inject an unexpected path
// segment.
function sanitizeFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? 'file';
  return base.replace(/[^a-zA-Z0-9._-]/g, '_');
}
