# Sefay cashier app - ChatGPT image prompt (2026-11-09)

Purpose: generate the look of the cashier app (pilot: car wash, Sunmi handheld). Paste the prompt below into ChatGPT (image generation). The mock is for visual direction only; text inside the generated image is not a specification.

## Prompt

```
Design a mobile cashier (POS) app UI for a car wash, as a clean modern product design mockup board. Output ONE image per request showing 6 phone screens side by side on a light grey background, each in a thin device frame, with a small title above each screen.

DEVICE: Sunmi handheld POS, portrait, 5.5-6 inch (720x1280). All touch targets at least 48px, large readable text, one-hand use. Android look, rounded corners 16px, soft shadows.

LANGUAGE AND NUMBERS: Arabic UI, full RTL layout (back arrow on the right, primary action button at the bottom). ALL numbers must be English digits 0-9 (never Arabic-Indic). Currency shown as "SAR" after the number. Font: a clean Arabic UI font (Cairo / IBM Plex Sans Arabic / Noto Sans Arabic).

STYLE: deep navy (#0C447C) as primary, teal (#14B8A6) as accent, white cards on #F5F7FA background, green for success, amber for warning, red for danger. Minimal, friendly, professional (like a modern fintech/POS app, not cartoonish). Optional dark variant uses #0B1220 background.

THE SALE FLOW (this exact sequence), screens in this order:
1. Product / service grid: top search bar + horizontal category chips (Wash, Polish, Interior, Add-ons). Grid of service cards with icon, Arabic name and price in SAR. Bottom sticky cart bar: "3 items - 85.00 SAR" and a big "Next" button.
2. Fields page (only shown when enabled): customer and vehicle fields: plate number (with letters/numbers input), phone, vehicle size selector (small / medium / large), plus any custom field the owner enabled (text, select, yes/no). Required fields marked with a red asterisk. "Next" button.
3. Payment method: large selectable tiles for Cash, Mada, Visa, Mastercard and "Split". Order summary on top with subtotal, discount, VAT 15%, total. Cash tile opens an amount-received numeric keypad with a green "Change: 14.25 SAR" line.
4. Confirm payment: summary card, selected method, amount, big "Confirm payment" button; show a loading state variant.
5. Invoice / success: green check, invoice number, date, items, VAT, total, payment method. If auto-print is on: "Printing..." status with a progress dot. If manual: two buttons "Print" and "Back without printing". Below: "Add invoice note" link. Then a "New sale" button that returns to the product grid.
6. Add invoice note: a text area with the invoice summary on top, "Save" and "Back to invoice".

ALSO DESIGN (second image, 6 more screens): Open register (opening cash keypad); Orders list with status chips and a "Return items" action; Return items (select lines + quantities, shows refund amount and where it is paid from); Close register with blind count (4 fields: cash, mada, visa, mastercard) ; Close report (totals, per-method table: sales / returns / expected / counted / difference, buttons Print and Share PDF); Error states board (printer out of paper, no network, payment failed, no open register).

EXTRAS TO SHOW SOMEWHERE: a small queue board (Waiting / Washing / Ready columns of car cards with plate number and assigned worker), a worker picker per service line, a held-order drawer, and a discount sheet that asks for a manager PIN.

Make every screen look like the same product. Keep generous spacing, clear hierarchy, and consistent icons (rounded line icons).
```
