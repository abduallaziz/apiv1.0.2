// Document Template Builder (docs/DESIGN_DOCUMENT_BUILDER.md) — shared types. Phase 1 only
// establishes the shape; template/asset/generation services (Phases 2-4) build on this.

export type DocumentType =
  | 'quotation'
  | 'tax_invoice'
  | 'simplified_invoice'
  | 'receipt'
  | 'payment_voucher'
  | 'work_order'
  | 'delivery_note'
  | 'purchase_order'
  | 'customer_statement'
  | 'custom';

export const DOCUMENT_TYPES: DocumentType[] = [
  'quotation',
  'tax_invoice',
  'simplified_invoice',
  'receipt',
  'payment_voucher',
  'work_order',
  'delivery_note',
  'purchase_order',
  'customer_statement',
  'custom',
];

export type DocumentTemplateStatus = 'draft' | 'published' | 'archived';
export type DocumentTemplatePaper = 'A4' | 'A5' | '80mm' | '58mm';
export type DocumentTemplateOrientation = 'portrait' | 'landscape';

export type DocumentAssetCategory =
  | 'company_stamp'
  | 'branch_stamp'
  | 'department_stamp'
  | 'signature'
  | 'logo'
  | 'image'
  | 'qr_config';

export type DocumentAssetStatus = 'active' | 'archived';
export type GeneratedDocumentStatus = 'issued' | 'void';
export type DocumentApprovalDecision = 'approved' | 'rejected';
