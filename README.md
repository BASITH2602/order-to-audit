# Order to Audit

A working order-to-audit system for a small packaged-snack manufacturer. Every transaction is entered once, at its source, and flows into stock, production, costing, GST invoices and the monthly auditor reports.

- **Sales loop:** salesman order (mobile) → admin verification with stock check → GST invoice (PDF) → dispatch → finished-goods stock down → payments and receivables.
- **Production loop:** purchase → raw material issued per recipe (BOM) → production run → finished-goods stock up → planned-vs-actual variance → cost per packet.

Both loops meet in one stock ledger and feed the reports. Design details are in [docs/DESIGN.md](docs/DESIGN.md).

## Stack and why

**Next.js (TypeScript) + PostgreSQL + Prisma, run with Docker Compose.** PostgreSQL gives exact `NUMERIC` decimals, transactions and constraints, which the ledger and money maths need; Prisma gives a readable, typed schema. One Next.js codebase serves the mobile salesman PWA and the desktop admin, production and accounts screens, so there is a single thing to run, test and explain. Live updates use Postgres `LISTEN/NOTIFY` pushed to browsers over Server-Sent Events, so no extra broker is needed.

## Run it

### Evaluators: one command, with test logins

```bash
docker compose --env-file .env.benchmark up --build
```

Open <http://localhost:3000>. This loads the exact Section 5 master data and opening balances. Password for every login: `Benchmark@2026` (demo values only, in `.env.benchmark`).

| Role | Username | Opens |
|---|---|---|
| Salesman A (phone) | `salesman_a` | `/sales` |
| Salesman B (phone) | `salesman_b` | `/sales` |
| Factory admin | `admin` | `/admin`, `/masters`, `/reports` |
| Production supervisor | `production` | `/production` |
| Accountant (read-only) | `accountant` | `/reports` |
| Owner | `owner` | `/owner` |

To reset to a fresh benchmark: `docker compose down -v` and run the command again.

For a phone on the same network, open `http://<your-computer-ip>:3000` (the benchmark file already sets `COOKIE_SECURE=false` so login works over plain http).

### Without Docker for the app (fastest way to see it while developing)

Only the database runs in Docker; the app runs with `npm run dev`.

```bash
cp .env.local-demo .env       # demo values; Windows PowerShell: Copy-Item .env.local-demo .env
npm install
docker compose up -d db
npm run demo:setup            # creates tables, company + admin, benchmark data
npm run dev
```

Open <http://localhost:3000> and sign in (see the logins table above).

### Real installation (no demo data)

```bash
cp .env.example .env     # fill in company details, a strong admin password, SESSION_SECRET
docker compose up --build -d
```

Only the company settings and the first admin are created from your `.env`. Everything else (users, materials, products, recipes, customers, opening stock) is entered in the app under **Masters**.

### Local development

```bash
docker compose up -d db
cp .env.example .env            # set DATABASE_URL, SESSION_SECRET
npm install                     # dependencies: see "Dependencies" below
npx prisma migrate dev          # creates tables; commit prisma/migrations
npx tsx prisma/bootstrap.ts     # company + admin (see .env.example)
npm run dev
```

The repository already contains `package.json`, TypeScript, Tailwind and Prisma configuration, so `npm install` is all that is needed. After you first run `npx prisma migrate dev --name init`, commit the generated `prisma/migrations` folder.

## Tests

```bash
# Pure maths tests (no database): costing, GST, units, GSTIN, report ranges, CSV
npx vitest run tests/gst.test.ts tests/units.test.ts tests/gstin.test.ts tests/reports.test.ts

# Full benchmark replay, asserting every Section 5 checkpoint. WARNING: resets the database it points at.
# Use a throw-away database, never a real one. Create it once with:
#   docker compose exec db createdb -U ota ota_test
DATABASE_URL=postgresql://ota:ota@localhost:5432/ota_test BENCHMARK_PASSWORD=Benchmark@2026 \
  npx prisma migrate reset --force && \
DATABASE_URL=postgresql://ota:ota@localhost:5432/ota_test npx vitest run
```

`tests/benchmark.test.ts` replays steps 1 to 9 (purchase, production, both orders, payment, overheads, reports) against the real database and asserts the numbers in the table below.

## Roles

| Role | Can do |
|---|---|
| Salesman | Place orders, see own orders and customer-wise sales, view own invoices |
| Factory admin | Verify/edit/approve/reject orders, invoices, dispatch, payments, masters, users, adjustments, reports |
| Production supervisor | Receive material, log production runs and overheads, view stock |
| Accountant | Read-only reports and receivables |
| Owner | Dashboard and reports |

Roles are enforced on every API route and re-checked against the database on each request (a deactivated user loses access immediately).

## Feature checklist (Section 6)

**Must have**
- [x] Login with salesman, admin, production (plus accountant, owner)
- [x] Product, customer, raw-material and BOM masters (plus suppliers, users)
- [x] Mobile-friendly order entry and admin approval
- [x] GST invoice as PDF
- [x] Production run updates raw-material and finished-goods stock automatically
- [x] Planned vs actual consumption and yield, with variance shown
- [x] Stock summary and stock ledger
- [x] Sales register and stock report, exportable to CSV/Excel (and PDF)

**Should have**
- [x] Purchases and supplier records
- [x] Payments, outstanding and ageing
- [x] Cost per packet with overheads
- [x] GST summary report (GSTR-1 / 3B shaped) and HSN summary
- [x] Variance alerts beyond tolerance (flagged in screens and reports, live alert on the production screen)
- [x] Owner dashboard

**Stretch**
- [x] Offline order capture with sync (phone queue + idempotent server)
- [x] Reorder levels and low-stock flags for materials (flag in stock views, no push notification)
- [x] Live updates across screens (Server-Sent Events)
- [x] Signed, expiring invoice share link (WhatsApp)
- [ ] Batch and expiry tracking: batch and expiry are stored on purchases and ledger rows, but there is no first-expiry-first-out dispatch
- [ ] Production planning from pending orders, route/GPS log, Tally export, e-invoice mock, Tamil interface

## Benchmark results (Section 5)

Asserted by `tests/benchmark.test.ts`.

| Check | Expected | This system |
|---|---|---|
| Flour closing balance | 120 kg | 120 kg |
| Oil closing balance | 19.5 L | 19.5 L |
| Pouches closing balance | 306 | 306 |
| Finished goods after run | 238 | 238 |
| Finished goods after Retailer A dispatch | 88 | 88 |
| Yield variance | −6%, flagged | −6%, flagged |
| Oil consumption variance | +5%, flagged | +5%, flagged |
| Retailer A invoice | ₹7,500 + ₹187.50 + ₹187.50 = ₹7,875 | same |
| Retailer A outstanding | ₹3,875 | ₹3,875 |
| Distributor B order | Shortage of 32 flagged; IGST if invoiced | Shortage 32 flagged, approval blocked; at 88 packets: ₹4,400 + ₹220 IGST = ₹4,620 |
| Cost per packet | our figure | **₹31.14** (margin ₹18.86, 37.71%) |

**Cost per packet:** weighted-average cost of materials on the actual quantities used (flour ₹43.125/kg after the second purchase, oil ₹140/L, spice mix ₹200/kg, pouches ₹2.50, cartons ₹15) = ₹4,055.00, plus ₹1,200 labour and ₹600 gas/power = ₹5,855.00, divided by 188 good packets.

Verified on 27 Nov 2026 with `npx vitest run` (all tests passing).

**Differences and interpretations (reasoned, not accidental)**
1. **Pouches:** the BOM says 200 per batch, but the benchmark expects a closing balance of 306, which means 194 were consumed (188 good + 6 damaged). The supervisor's form has a button that sets pouches = good + damaged. Pouch variance is −3% (194 vs 200), which is not flagged because the rule is *strictly beyond* the ±3% tolerance.
2. **Cartons:** 9 were used against a planned 10, which is −10%. This is flagged. The brief does not list it as a check, but the rule applies equally to packaging.
3. **Flour cost:** the flour issued (40 kg) is valued at the weighted average (₹43.125/kg), not the ₹42 opening or ₹45 new rate.
4. **Distributor B:** with 88 packets left, the 120-packet order cannot be approved. The admin screen shows the 32-packet shortage and the approval is refused. The admin reduces the line to 88 and approves, and because Karnataka differs from Tamil Nadu the invoice carries IGST.
5. **Opening finished-goods cost:** not given in the brief. ₹30/packet is invented for the 50 opening packets (marked in `prisma/seed.ts`). It does not affect cost per packet of the run.

## Assumptions

- Factory state is Tamil Nadu (code 33). A customer in the same state gets CGST+SGST; any other state gets IGST. Selling price is before tax; GST is 5% on this product.
- Quantities are stored as integers in base units (g, ml, pieces); money is integer paise. Rates are stored as exact decimals in paise per base unit.
- **Valuation: moving weighted average** per item, because purchases at different rates (₹42, ₹45) are mixed in one bin and FIFO layers add bookkeeping the prototype does not need.
- **Overhead rule:** all labour, power/gas and other overheads of a run are spread equally over that run's good packets. Damaged pouches and over-use stay in material cost, so wastage raises cost per packet.
- Variance tolerance is 3% (setting), compared as strictly greater than.
- Stock check on approval counts stock promised to other approved or invoiced (not yet dispatched) orders.
- Financial year runs April to March, calculated in IST. Invoice numbers are `YYYY-YY/0001` per financial year, and cancelled invoices keep their numbers.
- Invoice totals are not rounded to the nearest rupee. Cancelling an invoice reverses it in full by credit note.
- Reports use IST calendar days, inclusive. An invoice appears in the period issued and its credit note in the period raised (the way GSTR-1 nets cancellations).

## Known gaps

- No partial dispatch, partial returns or partial credit notes (optional in the brief). Cancelling reverses the whole invoice and can return stock.
- Finished-goods ledger cost is material cost only; overheads appear in run costing, not in ledger valuation. A cost-of-goods-sold figure is therefore not reported.
- No first-expiry-first-out dispatch; materials and items cannot be edited or archived after creation; no audit-log viewer screen (the log is written for invoices, orders, runs, masters, payments, users and adjustments).
- The invoice PDF has no amount in words and prints "Rs." (standard PDF fonts have no ₹ glyph).
- Login lockout is in memory (single instance). Session cookies rely on `SameSite=Lax` with JSON-only APIs, without a separate CSRF token.
- No e-invoice/e-way bill, Tally export, Tamil UI, route/GPS log or production planning.
- The offline queue uses browser storage and needs one online visit to cache the page and master lists.

## Project layout

```
prisma/            schema, bootstrap (real install), seed (Section 5 benchmark)
src/lib/           stock ledger, costing, sales loop, GST, reports, exports, auth, units
src/app/api/       role-checked route handlers (one wrapper: src/lib/api.ts)
src/app/           screens: sales (mobile), admin, production, owner, reports, masters, login
tests/             unit tests and the Section 5 benchmark replay
docs/              DESIGN.md, DEMO_SCRIPT.md
```

## Demo video

[Watch demo video on YouTube](https://youtu.be/vEBs_ZoM0_g) – script in [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md).
