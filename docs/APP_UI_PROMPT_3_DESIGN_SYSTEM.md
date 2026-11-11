# Sefay cashier app - prompt 3: design system + all pages (2026-11-09)

Use after the two earlier boards. Send it as the FIRST message of a new ChatGPT chat together with the best earlier board as a style reference, then ask for each group one by one.

```
You are a senior product designer. Create the complete visual identity and the full set of screens for "Sefay Car Wash POS", a cashier app for car washes running on Sunmi handheld POS devices (5.5-6 inch portrait, 720x1280) and tablets. Use the attached image as the style reference and keep the same look.

HARD RULES (apply to every image)
- Arabic UI, full RTL. EVERY label, button and message in Arabic (no English words in the UI; the only Latin text allowed is "SAR" and the brand name Sefay). Forward/next arrows point LEFT, back arrows point RIGHT, the back button sits at the top-right.
- ALL numbers use English digits 0-9 (never Arabic-Indic). Money as "85.00 SAR".
- Touch targets at least 48px, body text at least 16px, AA contrast. One-hand use: primary action always in a sticky bottom bar.
- NO expenses screens (the owner records expenses on the website only). NO offline mode in v1.
- Every screen shares the same header, bottom navigation (Sale, Orders, Queue, Customers, More), spacing and components.

IDENTITY (design this first, as image 1: "Design System")
- Logo: "Sefay" wordmark with a small car + water-drop mark, light and dark versions, app icon (rounded square).
- Colors with names and hex: primary navy #0C447C, accent teal #14B8A6, background #F5F7FA, surface white, text #0F172A / secondary #64748B, border #E2E8F0, success #16A34A, warning #F59E0B, danger #DC2626, info #2563EB; dark mode: background #0B1220, surface #111A2E, text #E5E7EB.
- Typography: one Arabic UI font (Cairo or IBM Plex Sans Arabic), scale: display 28, title 22, heading 18, body 16, caption 13; numbers tabular.
- Shape and depth: 8px grid, radius 12 (cards) / 16 (sheets) / 999 (chips), soft elevation, thin borders.
- Icons: rounded line icons, 24px, consistent stroke.
- Components sheet: primary / secondary / destructive / ghost buttons (normal, pressed, disabled, loading), text field states (empty, focused, filled, error), numeric keypad, chips, status badges (waiting, washing, ready, completed, cancelled, returned), cards, list rows, bottom sheet, dialog, toast, empty state, skeleton loader, stepper, segmented control, switch.

SCREENS (then deliver them as separate images, 6 phones per image, each phone titled in Arabic):
A. Entry: splash, login (email + password), choose branch, no-open-register state, open register (opening cash keypad).
B. Sale: service grid (categories, search, vehicle-size tabs with size-based prices), cart review (edit quantity, remove line, assign worker per line, note), CUSTOMER LOOKUP smart box (one field: plate or phone) with 5 states: empty, found (name, plate, visits, last visit), found with several cars (choose the car), not found (create new customer: plate + phone + enabled custom fields), conflict error (plate belongs to another customer than this phone), fields page (plate, phone, vehicle size, custom fields incl. yes/no and select), discount sheet with manager PIN, payment method tiles (Cash, Mada, Visa, Mastercard, Split), cash keypad with change, split payment (cash part + card part), confirm payment, processing, success invoice with auto-print state, print failed with retry, manual print vs back-without-printing, add invoice note and back to the invoice.
C. Orders and returns: orders list with filters and status chips, order details, reprint / share on WhatsApp, return items (pick lines and quantities, refund preview, where it is paid from), cancel invoice dialog with reason, held orders drawer.
D. Queue: queue board (waiting / washing / ready), car card details, assign worker, change status, "car ready" notification sent confirmation.
E. Register: open register, open cash drawer, close register with blind count (cash, Mada, Visa, Mastercard), close report (totals, per-method table: sales / returns / expected / counted / difference), print and share PDF, register history.
F. Customers: customer list with search by plate or phone, customer profile with his cars and visit history, add a car to an existing customer.
G. Reports (read-only, for the manager): today summary, sales by payment method, sales by worker.
H. More / Settings: printer (auto print on/off, paper width 58/80 mm, test print), language, theme, payment methods on/off, account, about.
I. System states: loading skeletons, empty states, no network, printer out of paper, payment failed, no open register, permission denied, update available.
J. Dark mode versions of six key screens (service grid, cart, payment, success, orders, close report).
K. Tablet landscape layout (1280x800) of the sale screen: services on the right, cart panel on the left.

Deliver in this order: 1) Design System sheet, 2) A, 3) B (two images), 4) C, 5) D+E, 6) F+G+H, 7) I, 8) J, 9) K. Keep every screen consistent with the Design System sheet.
```
