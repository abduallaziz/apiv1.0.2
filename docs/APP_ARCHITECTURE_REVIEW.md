# Sefay cashier app - architecture review (2026-11-09) - REVIEW ONLY, nothing built

Owner decisions: visual identity LOCKED (boards of 2026-11-09, see TASKS.md APP-UI-IDENTITY-*); technology CONFIRMED: native Android, Kotlin + Jetpack Compose. The backend stays the single source of truth; the app only consumes approved contracts (api/CLAUDE.md Application/Mobile Execution Rule). The older documented plan (pos_m = React Native + Expo + WebView) is SUPERSEDED for this app.

## 1. Technology (proposal, to approve)
- Language/UI: Kotlin 2.x, Jetpack Compose (Material 3 themed with the locked tokens), Navigation Compose, native RTL (strings.xml ar + en; English digits forced for numbers).
- Architecture: single-activity, MVVM + unidirectional state (ViewModel + StateFlow), feature modules (auth, shift, sale, orders, returns, customers, queue, settings), repository layer over the API.
- DI Hilt; network Retrofit + OkHttp + kotlinx.serialization; tokens in Android Keystore (EncryptedSharedPreferences/DataStore); Room only as a CATALOG CACHE (services, categories) - offline sales are OUT of v1; Coil for images; Timber logs; Crash reporting (Firebase Crashlytics or Sentry, to choose).
- Printing: Sunmi native printer SDK (AIDL / com.sunmi:printerlibrary) behind a PrinterService interface; fallback ESC/POS over Bluetooth/LAN for non-Sunmi devices; one receipt model rendered by the SAME server-built payload as the web (T1-T3, T13); PDF share through the Android share sheet.
- minSdk 24 (Sunmi V1/V2 family Android 7+), targetSdk current, build with Gradle version catalogs, CI = lint + unit tests + assemble.
- iPhone later: shared logic can move to Kotlin Multiplatform (models, API client, business rules) with SwiftUI screens; not part of v1.
- Repo: separate project (proposal C:\Fp\sefay-android), never mixed with api/web repos (owner rule: keep projects isolated).

## 2. The 8-point dependency check (Application/Mobile rule) per capability
| Capability | API | Contract | Authz | Business logic | Schema | Source-of-truth spec | Runtime validation | Blocker |
|---|---|---|---|---|---|---|---|---|
| Login / session | exists | exists | exists | approved | exists | exists | yes | G1 (native token flow) |
| Open / close register, report, PDF | exists (phases 2-4) | exists | exists | approved | applied | design review | yes | none |
| Service catalog + sizes | GET /items (+variants) exists | exists | exists | size prices = variants (to confirm) | exists | partly | yes | G3 |
| Sale (create invoice) | exists | CreateInvoiceDto | exists | approved | exists | yes | yes | G4 (worker per line) |
| Customer smart lookup | missing | missing | - | owner decision T12 | missing | T12 | - | G2 |
| Returns / cancel | exists (3a, 3b) | exists | invoice.cancel | approved | applied | yes | yes | none |
| Invoice note after sale | missing | missing | - | owner spec | none needed | spec | - | G6 |
| Printing payload (invoice) | missing | missing | - | T13 | T13 | T13 | - | G7 |
| Payment methods on/off | missing | missing | - | T11 | T11 | T11 | - | G8 |
| Car queue + ready notification | missing | missing | - | spec only | missing | spec only | - | G5, G9 |

## 3. Backend gaps the app needs (each = its own design review + approval)
- G1 Native auth: the refresh token is returned ONLY as an httpOnly cookie (auth.controller) and /auth/refresh reads only the cookie. A native client needs refresh token in the response body / Authorization header mode and device registration (device_sessions exists).
- G2 Customer lookup (T12): exact normalised lookup by plate or phone, customer_vehicles, auto-create at sale confirmation, plate on the order.
- G3 Size-based pricing: confirm items.has_variants / item_variants with a "vehicle size" attribute is the model (price per variant), and a catalog endpoint shaped for the POS (categories + services + sizes in one call).
- G4 Worker per invoice line + commission snapshot (users.commission_rate exists; no worker field on invoice lines).
- G5 Wash queue: a job per car (waiting / washing / ready), assignment, history; realtime push for the board (web realtime exists).
- G6 Invoice note after the sale: editable non-financial note with audit.
- G7 Print payload service: one endpoint that returns the invoice/kitchen ticket layout data (tenant template T13, business details, optional tax number, QR when required) so web and app print identically.
- G8 Payment methods per tenant (T11) in pos-config.
- G9 "Car ready" notification channel (SMS or WhatsApp provider to choose; cost and consent to decide).

## 4. Proposed build order (after owner approval; each step finished before the next)
0) backend gaps needed by the pilot flow: G1, G2 (T12), G3 confirmation, G4, G6, G7 (with T13 basics), G8; phase 5 (T8) first.
1) app skeleton: project, theme from the identity tokens, auth + branch + open register.
2) sale flow end to end with cash/card, receipt print on Sunmi, note after sale.
3) orders, returns, register close + report print/share.
4) customers lookup screens, queue board (needs G5/G9), reports, settings.
Pilot minimum = steps 0-3. Free car-wash pilot checklist stays in TASKS.md T6.

## 5. Risks
- Sunmi printing is UNVERIFIED on the pilot device (Arabic shaping, auto print): test on the real device before step 2 is declared done.
- Tokens, PIN for discounts and the register must stay server-validated; the app never decides prices, tax or permissions.
- Release/signing and Play/side-load distribution not yet decided (pilot = side-loaded APK).
