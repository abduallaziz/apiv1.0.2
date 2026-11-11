// Generic file-storage contract. This module knows nothing about any
// business domain (Expenses, Departments, Accounting, ...) — callers supply
// ownerType/ownerId purely as opaque strings for path-scoping and metadata.

export interface StorageUploadInput {
  tenantId: string;
  ownerType: string;
  ownerId: string;
  uploadedBy: string;
  fileName: string;
  fileType: string;
  fileBuffer: Buffer;
}

export interface StorageUploadResult {
  fileUrl: string;
  fileType: string;
  storagePath: string;
}
