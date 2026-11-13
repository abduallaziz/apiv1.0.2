# Document Template Builder — Implementation & Operations Reference

**Status:** All 11 phases implemented (2026-11-13). Behind `DOCUMENTS_BUILDER_ENABLED` (default **off**).
Design: `DESIGN_DOCUMENT_BUILDER.md` (the pre-implementation design and per-phase log).

## 1. Turning it on (checklist)

1. `DOCUMENTS_BUILDER_ENABLED=true` on the API (Railway). Nothing is reachable while it is off: all
   `/documents/*` routes return 403, the public verify route returns 404 and the web nav link is hidden
   (`GET /documents/enabled` reports the flag).
2. `SUPABASE_STORAGE_BUCKET` must name a real **private** bucket (assets and issued PDFs live there).
3. `FRONTEND_URL` must be the public web URL (it is embedded in verification QR codes).
4. Chrome/Chromium on the API host (same requirement as the shift-report PDF).
5. Migrations 273–277 applied (done) and permissions seeded (runs on every `start:prod`).

## 2. Permissions

| Key | Who (default) | Allows |
|---|---|---|
| `documents.view` | owner, manager, superadmin | list/read templates, assets, issued documents, approvals; download PDFs |
| `documents.manage` | owner, manager, superadmin | create/edit/publish templates, manage assets, preview, **issue** documents |
| `documents.approve` | owner, superadmin | approve/reject a template that uses stamps/signatures; void an issued document |

## 3. API (all tenant-scoped, behind the flag)

```
GET  /documents/enabled                      flag status (any signed-in user)
GET  /documents/bindings                     whitelist of bindable fields + QR minimum sizes

Templates  /documents/templates
  GET, POST                                  list (docType,status) / create
  GET|PATCH|DELETE /:id                      read (draft body) / edit / soft-delete
  POST /:id/duplicate | publish | archive | default
  GET  /:id/versions        POST /:id/versions/:v/restore
  GET|POST /:id/assignments                  tenant or branch scope, per document type
  GET  /:id/preview?lang=   POST /:id/preview   HTML (stored draft / unsaved draft), SAMPLE data
  GET  /:id/pdf?lang=                         PDF with SAMPLE data

Assets     /documents/assets                 PNG/JPEG/WEBP <= 5 MB, private bucket
  GET, POST(multipart)  GET|PATCH|DELETE /:id  POST /:id/version (replace, history kept)
  GET /:id/signed-url (300 s, audited)         GET|POST /:id/permissions, DELETE /:id/permissions/:pid

Issuing    /documents
  POST /generated/issue                      {doc_type, source_id, template_id?, lang?, input?}
  GET  /generated, /generated/:id, /generated/:id/html, /generated/:id/pdf
  POST /generated/:id/void                   (documents.approve)
  POST /approvals    GET /approvals?templateId=&docType=

Public     GET /public/verify/:token         no auth, read-only, whitelisted fields only
```
(Deviation from the design: issuing is `POST /documents/generated/issue` instead of
`/documents/:docType/:sourceId/issue`, to avoid ambiguity with `/documents/templates/...`.)

## 4. Rules enforced on the server

- **Template body** is validated JSON (`template-body.util.ts`): whitelisted element types, bounded
  geometry (mm), opacity 0–1, rotation ±360°, ≤300 elements, unknown keys stripped, `{{bindings}}`
  restricted to the catalog (`bindings.catalog.ts`), table columns restricted to known item fields,
  every referenced asset must belong to the tenant. No code, no expressions.
- **Money** is never computed or altered by a template. Invoices/receipts read the stored order
  figures verbatim (read-only); quotations/vouchers/etc. take line inputs and the server computes
  line totals, VAT (tenant rate, inclusive/exclusive) and the grand total in integer halalas.
- **Rendering**: one HTML (`template-render.service.ts`) feeds preview, PDF and print. All values are
  escaped; images only from signed/data URLs of tenant assets; only whitelisted data reaches the page;
  numbers use English numerals; `@page` margins repeat on every printed page (table frame trick).
- **QR** (`qr.util.ts`): inline SVG, quiet zone, ECC M. Kinds: verification, ZATCA (existing util, or
  the already-issued Phase 2 QR of the sale), payment, custom https URL. Guard: square, opacity ≥ 0.85,
  minimum size from the real module count; an unscannable QR blocks issuing.
- **Stamps / signatures**: issuing requires (a) a published template, (b) an `approved` decision made
  after that version was published and still the latest, (c) the issuer allowed by the asset's
  role/branch permissions (an explicit `can_use=false` wins), (d) every used asset active. Checked
  at issue time (twice: before rendering and inside the committing transaction), not in the editor.
- **Immutability**: an issued document stores self-contained HTML (images embedded), the resolved data,
  asset references, the PDF and a verification token. DB triggers (migration 277) freeze those columns;
  only `status` (issued → void) and `deleted_at` may change; `document_approvals` has no UPDATE/DELETE.
- **Audit**: asset upload/replace, signed URL for stamps/signatures, approval decisions, issue (with
  SHA-256 of the HTML and the stamp/signature ids used) and void.
- **Verification page** shows only `document_number, document_date, issuer_name, issuer_vat_number,
  total`, status and type — never customer data — and no actions.

## 5. Web (settings → document templates)

`/dashboard/settings/documents` (list), `/[id]` (editor), `/assets` (stamps & signatures),
`/generated` (issued documents), `/[locale]/public/verify/[token]` (public page).
Editor: elements panel (blocks, assets, QR, layers), canvas (server-rendered page + live overlay layer:
drag, resize, rotate, snap guides, arrow-key nudge), inspector (page, text + field picker, table
options, overlay geometry/opacity/layer/lock/anchor, QR), undo/redo, zoom, AR/EN preview, PDF download,
autosave of the draft, unsaved-changes guard, Ctrl+S / Ctrl+Z / Ctrl+Y / Delete / Esc.

## 6. Known limits / not built

- Fonts use the system stack (same as the shift report); Cairo is not bundled (needs a font file).
- Preview uses fictional sample data; there is no "preview with real data" (issuing produces the real PDF).
- Overlay elements are positioned on page 1 (`anchor: first`) or repeated on every page (`every`);
  there is no "last page" anchor. The editor supports one template page plus natural overflow.
- No right-click context menu in the editor (toolbar/inspector/keyboard cover the same actions).
- Resizing a rotated overlay resizes in its own un-rotated frame.
- Cryptographic e-signatures are out of scope (the signature-QR is a verification element only).
- `StorageService` has no delete: a failed DB insert after an upload leaves an unreachable private file.
- Web has no automated test runner; web is verified by `tsc` + `eslint`. Backend: 118 specs for this
  module (933 in the API suite), including QR decoding with jsQR and the immutability triggers
  verified on the live database inside a rolled-back transaction.
