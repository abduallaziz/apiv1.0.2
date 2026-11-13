# DESIGN — Advanced Document Template Builder (SEFAY)

**Status: ARCHITECTURE REVIEW ONLY.** No code, migrations or DDL until the exact message
`Approved – Proceed with Implementation`. This document is the design for review.

Full scope (all phases of the brief), delivered **risk-free via strict sequential, isolated,
feature-flagged phases** — never all-at-once. Each phase is complete + tested + merged before the
next (per Sefay's mandatory Sequential Execution Order).

---

## 1. Goals & non-negotiable safety constraints

Build a multi-tenant document template builder: multiple templates per document type, a visual
hybrid editor (structured business components + freely-positioned assets), a private stamp/signature
library, multi-QR, dynamic bindings, multi-page tables, approval/authorization, and immutable issued
documents — serving quotations, invoices, receipts, and more.

**Must not** (hard constraints):
- Touch `orders` / `order_items` / invoice / POS / accounting / VAT / ZATCA calculation logic.
- Expose private stamps/signatures via public URLs.
- Let a template compute or alter financial values, or execute arbitrary JS/expressions.
- Allow any cross-tenant access through template/asset/branch IDs, APIs or generated files.

**Reuse as-is (no modification):** `StorageService` (private Supabase storage, signed URLs),
puppeteer-core HTML→PDF renderer, ZATCA QR (`print/zatca-qr.util.ts` + zatca module), the
permissions system + `@RequirePermission`, `TenantSessionService` + RLS pattern, invoice designer v2
(`print-template.util.ts`, `renderReceipt.ts`) as the structured-component foundation.

---

## 2. Architecture decisions (ADR summary)

| # | Decision | Why |
|---|---|---|
| A1 | New isolated module `modules/documents/` + new tables; do **not** extend `tenants.invoice_template` JSONB | Isolation from financial/printing code = zero regression risk |
| A2 | **Single HTML/CSS source of truth** for preview + PDF + print (absolute-positioned `mm`, same markup in browser and puppeteer) | Guarantees canvas == PDF; reuses existing renderer |
| A3 | **Hybrid editor**: structured components (items table, totals, customer block) stay in document flow; stamps/signatures/QR/images are free overlay layers | Avoids a Canva clone; keeps data reliable |
| A4 | Template body = validated JSON (elements + bindings), **no executable code**; whitelist of bindings only | Security; deterministic rendering |
| A5 | Element **instances** stored separately from **assets** (an asset placed N times = N instances) | Meets "same stamp used multiple times, each with own x/y/rotation/opacity/z" |
| A6 | Issued documents persist an **immutable snapshot** (rendered HTML + resolved data + asset refs) | Old documents never change when a template is edited |
| A7 | Everything behind `DOCUMENTS_BUILDER_ENABLED` feature flag until complete | No user-visible impact mid-build |
| A8 | Financial values always come from backend business logic and are injected read-only | Templates can never change tax/totals |

---

## 3. Database design (new tables — all `tenant_id` scoped, RLS, `service_role` GRANT, `deleted_at`)

### 3.1 `document_templates`
- `id uuid pk`, `tenant_id`, `doc_type text` (quotation|tax_invoice|simplified_invoice|receipt|payment_voucher|work_order|delivery_note|purchase_order|customer_statement|custom), `name`, `description`
- `status text` (draft|published|archived), `is_default bool`, `paper text` (A4|A5|80mm|58mm), `orientation text` (portrait|landscape)
- `current_version_id uuid null`, `created_by`, timestamps
- Unique partial index: one `is_default = true` per (tenant_id, doc_type) where not deleted.

### 3.2 `document_template_versions` (immutable snapshots for restore)
- `id`, `tenant_id`, `template_id`, `version int`, `body jsonb` (page defs + element instances + bindings + table config), `created_by`, `created_at`, `note`
- Unique (template_id, version).

### 3.3 `document_template_assignments`
- `id`, `tenant_id`, `template_id`, `scope text` (tenant|branch), `branch_id null`, timestamps
- Resolution order at issue time: branch assignment → tenant default → built-in fallback.

### 3.4 `document_assets` (stamps/signatures/logos/images/QR configs)
- `id`, `tenant_id`, `category text` (company_stamp|branch_stamp|department_stamp|signature|logo|image|qr_config)
- `name`, `storage_path` (PRIVATE bucket), `mime`, `width_px`, `height_px`, `checksum`, `status` (active|archived)
- `branch_id null` (ownership/visibility), `created_by`, timestamps. No public URL column — access only via signed URL.

### 3.5 `document_asset_versions`
- `id`, `tenant_id`, `asset_id`, `version`, `storage_path`, `created_by`, `created_at` (replace keeps history).

### 3.6 `document_asset_permissions`
- `id`, `tenant_id`, `asset_id`, `role_id null` / `branch_id null`, `can_use bool` (who may place/issue with a sensitive asset).

### 3.7 `document_approvals`
- `id`, `tenant_id`, `doc_type`, `template_id`, `generated_document_id null`, `approver_id`, `approved_at`, `decision text` (approved|rejected), `reason`, immutable.

### 3.8 `generated_documents` (immutable issued-document record)
- `id`, `tenant_id`, `doc_type`, `source_ref` (e.g. quote_id / order_id), `template_version_id`, `rendered_html text` (or reproducible render record), `resolved_data jsonb`, `asset_refs jsonb`, `pdf_storage_path null`, `issued_by`, `issued_at`, `status`.

### 3.9 `document_verification_tokens`
- `id`, `tenant_id`, `generated_document_id`, `token text unique` (random), `public_fields jsonb` (whitelist only), `expires_at null`, `created_at`.

### 3.10 `document_audit_logs` (or reuse the existing AuditService)
- Stamp/signature usage, template publish, asset upload, approval — actor, timestamp, before/after.

> Fallback: continue using the existing `AuditService` where it fits instead of a new table.

---

## 4. Template body JSON (validated schema, no code)

```jsonc
{
  "pages": [{ "size": "A4", "orientation": "portrait", "marginsMm": {...} }],
  "elements": [
    { "id": "el-001", "page": 0, "type": "items_table", "region": "flow", "config": { "columns": [...] } },
    { "id": "el-002", "page": 0, "type": "totals", "region": "flow" },
    { "id": "el-010", "page": 0, "type": "stamp", "assetId": "asset-1",
      "position": {"x":145,"y":220,"unit":"mm"}, "size": {"width":38,"height":38,"unit":"mm"},
      "rotation": -12, "opacity": 0.75, "zIndex": 5, "locked": false, "visible": true,
      "maintainAspect": true, "anchor": "page" }
  ],
  "bindings": ["company.name","customer.name","quotation.number", "..."]
}
```
- Structured types (`region: "flow"`): company_info, customer_info, document_info, items_table,
  totals, terms, payment_details, footer, heading, text, divider, container.
- Free overlay types (`region: "overlay"`): stamp, signature, signature_qr, logo, image, qr. Each
  instance has its own geometry (the example structure in the brief is adopted verbatim).
  `signature_qr` is a placeable verification barcode (not a legal cryptographic signature; that
  provider is deferred).

---

## 5. State machines

### 5.1 Template lifecycle
```
draft ──publish──▶ published ──archive──▶ archived
  ▲                   │                       │
  └──── new version ◀─┘ (edit published = new draft version; publish replaces current_version_id)
restore(version) → creates a new draft version from an old snapshot
```

### 5.2 Generated document lifecycle
```
issue (snapshot taken) → issued (immutable) → [verification token optional] 
issued documents never mutate; re-issue creates a new generated_documents row
```

### 5.3 Approval (when a doc_type requires it)
```
pending_approval → approved → may_issue
                 ↘ rejected → cannot_issue
sensitive stamp/signature use requires an approved record (server-checked) before issue
```

---

## 6. Migration matrix

| Migration | Adds | Reversible | Touches existing? |
|---|---|---|---|
| `273_document_builder_core.sql` | templates, versions, assignments (+RLS, grants, indexes) | drop new tables | No |
| `274_document_assets.sql` | assets, asset_versions, asset_permissions | drop new tables | No |
| `275_document_generation.sql` | generated_documents, verification_tokens, approvals | drop new tables | No |
| `276_document_permissions_seed.sql` | `documents.view/manage/approve` + role grants | revoke | Permissions seed only |

Feature flag `DOCUMENTS_BUILDER_ENABLED` (env, default false) gates all routes + nav.

---

## 7. Rendering engine (Phase 8)

- `template-render.service.ts`: `render(templateVersion, resolvedData, assetSignedUrls) → HTML`.
- Same HTML string feeds (a) the editor live preview (iframe/sandboxed), (b) puppeteer → PDF,
  (c) print. Fonts embedded (Cairo / Noto Sans Arabic), RTL + mixed LTR, print-safe margins.
- Overlay elements: `position:absolute` in `mm`; structured elements in normal flow with page-break
  rules; repeated table headers; clip-prevention for rows/totals.
- Financial fields are injected from backend-computed `resolvedData` only.

---

## 8. Multi-tenant security & signature authorization (Phases 7, 9)

- Every query filtered by `tenant_id`; RLS enforced; ownership re-checked server-side for every
  `templateId` / `assetId` / `branchId`.
- Assets are **private**: served only via short-lived signed URLs; never a public bucket URL; never
  logged.
- Using a sensitive stamp/signature to **issue** a document requires: `documents.approve` (or the
  configured workflow) + an `document_approvals` record → audit log (actor + timestamp) → immutable
  `generated_documents` snapshot. Editing a template cannot bypass this (checked at issue time, not
  in the editor).
- Bindings are a server-side whitelist; unknown/unauthorized paths resolve to configurable
  placeholder behavior; no expression execution.

---

## 9. API surface (NestJS, tenant-scoped, permission-guarded)

```
Templates:   GET/POST /documents/templates ; GET/PATCH/DELETE /:id ;
             POST /:id/duplicate ; POST /:id/publish ; POST /:id/archive ;
             GET /:id/versions ; POST /:id/versions/:v/restore ; POST /:id/assignments
Assets:      GET/POST /documents/assets ; GET/PATCH/DELETE /:id ; POST /:id/version ;
             POST /:id/permissions ; GET /:id/signed-url
Generate:    POST /documents/:docType/:sourceId/issue (snapshot+render) ; GET /documents/generated/:id ;
             GET /documents/generated/:id/pdf   (download — the delivery mechanism; no email/WhatsApp)
Verify:      GET /public/verify/:token   (public, whitelist fields only, no auth)
Approvals:   POST /documents/approvals ; GET /documents/approvals?docType=
```
Permissions: `documents.view`, `documents.manage`, `documents.approve`.

---

## 10. UI structure (Phases 2, 10 — professional, RTL, Sefay identity #0C447C / #14B8A6 / #F5F7FA)

```
app/[locale]/dashboard/settings/documents/
  page.tsx                      → TemplatesListPage (status chips, filters, default, assign)
  [id]/page.tsx                 → TemplateEditorPage
  assets/page.tsx               → AssetsLibraryPage (stamps & signatures)
features/documents/
  components/editor/            → TopToolbar, ElementsLibrary(right), Canvas(center), Inspector(left)
  components/canvas/            → PageSurface, OverlayElement (drag/resize/rotate), SnapGuides, flow components
  components/PublicDocumentView.tsx
  api/documents.api.ts ; hooks/ ; types.ts
messages/{ar,en}/documents.json
```
- Hybrid editor; mm coordinates with accurate px conversion; zoom, grid/snap, alignment, layer order,
  multi-page preview; properties inspector reflects selection; autosave draft; unsaved-change guard;
  preview with sample data and with authorized real data; keyboard shortcuts; context menus; empty
  states. Tablet-friendly where practical.

---

## 11. Testing strategy (Phase 11)

Per-phase automated tests + a final suite: tenant isolation (incl. via asset/template/branch IDs),
template CRUD + versioning + restore, asset upload authorization, **multiple stamps/signatures in one
template with independent geometry**, drag/resize/rotation/opacity persistence, QR generation +
scannability validation, PDF accuracy vs canvas, RTL + long Arabic + mixed LTR, multi-page
pagination (no clipped rows/totals), dynamic binding replacement, **financial-integrity (template
cannot change totals/tax)**, unauthorized signature use blocked, approval enforcement, and
compatibility (existing invoices/POS/ZATCA untouched). No production tenant data in fixtures; no real
stamps in logs/fixtures.

---

## 12. Execution order (all phases; each 100% + tested + merged before the next)

1. `273–276` migrations + module skeleton + feature flag + permissions.
2. Template management (CRUD, duplicate, archive, default, assign, draft/publish, versions).
3. Asset library (upload private, categorize, versions, permissions).
4. Render engine (HTML→preview/PDF/print, RTL, fonts).
5. Visual editor shell (toolbar, elements, canvas, inspector, paper sizes).
6. Free overlay elements (stamp/signature/QR/image; mm geometry; multi-instance).
7. Dynamic bindings (visual picker, whitelist, server isolation).
8. Smart tables + multipage (columns, page breaks, repeated headers, anchoring).
9. QR management (verification public page, ZATCA reuse, payment, custom URL; scannability guard).
10. Approval & signature authorization (server auth, workflow, audit, immutable history).
11. UX polish + full test suite + docs.

Each phase: design confirmed → implement → tests green → tsc/lint clean → merge → deploy behind flag.
Flag flips on only after Phase 11.

---

## 13. Files expected (created / modified)

**Created (API):** `modules/documents/{documents.module,documents.controller,templates.service,assets.service,generation.service,template-render.service,verification.controller,document.types}.ts`,
`dto/**`, migrations `273–276`, `features.seed` entry, specs per service.
**Created (web):** `features/documents/**`, `app/[locale]/dashboard/settings/documents/**`,
`app/[locale]/public/verify/[token]/page.tsx`, `messages/{ar,en}/documents.json`.
**Modified (minimal):** `app.module.ts` (register module), permissions seed, settings nav (one link),
feature-flag registry. **No change** to invoices/POS/ZATCA/VAT code.

---

## 14. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Scope creep / Canva clone | Hybrid editor; strict phase order; flag-gated |
| Preview ≠ PDF | One HTML for both |
| Sensitive-asset leak | Private storage + signed URLs only; server authz; audit |
| Breaking financial/ZATCA | Separate tables; reuse (not modify) ZATCA QR; backend-only totals |
| Old documents changing | Immutable `generated_documents` snapshots |
| puppeteer cost at scale | Cache published-template render; queue heavy PDF |
| Cross-tenant via IDs | RLS + server ownership checks on every ID |

---

## 15. Delivery & open questions

**Delivery = PDF download only (confirmed).** The user downloads the generated PDF and sends it
themselves. No email, no WhatsApp, no sharing integration — removes the mailer dependency entirely.
Print output stays available. The document-verification QR (Phase 4) still produces a public
scan-to-verify page, but that is authenticity verification, **not** a sharing channel.

Decisions confirmed (owner, 2026-11-12):
1. **All document types in scope** (quotation, tax_invoice, simplified_invoice, receipt,
   payment_voucher, work_order, delivery_note, purchase_order, customer_statement, custom) — the
   `doc_type` enum carries them all; extensible.
2. **Quotation is a document to send** to a company / official entity. **No accept/reject** — not on
   a public link and not required as a customer action. The public verification page is **view/verify
   only** (no action buttons). Any internal "mark converted to invoice" stays staff-side and optional.
3. **Stamp / signature / signature-QR (barcode) are placeable elements** (asset library + free overlay
   + QR element) — IN SCOPE. A full **cryptographic e-signature provider is DEFERRED** (not needed
   now); the signature-QR is a visual/verification element, not a legal crypto signature.
```
```
**Next:** on `Approved – Proceed with Implementation`, execute Phase 1 only, then return for review before Phase 2.
