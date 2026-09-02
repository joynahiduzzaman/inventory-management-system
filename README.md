# Domingo Shop — Inventory & POS

A retail inventory and point-of-sale system: React frontend, Node/Express API, MySQL.

Built for a real counter — barcode scanning, credit sales, returns, and a stock
ledger that explains every number.

## Architecture

```
                 one Vercel project
┌──────────────────────────────────────────────┐
│  /          React SPA, served from the CDN   │
│  /api/*     Express app, one function        │  ──TLS──►  MySQL 8
│  /uploads/* product images, from the database│
└──────────────────────────────────────────────┘
```

Both halves ship from a single deployment and share one origin, so the browser
never pays for a CORS preflight and there is only one URL to remember.

`backend/app.js` builds the Express app and nothing else. Two entry points wrap
it: `backend/server.js` for a long-lived process (local development, or any
container host — it also creates the schema and seeds the first admin), and
`api/[...slug].js` for the Vercel function.

Uploaded product images go to Cloudinary and `products.image` holds the delivery
URL, so photos are served from Cloudinary's CDN without touching the API or the
database. With no Cloudinary account configured the app falls back to storing
them in the `product_images` table, so a fresh clone and the test suite work
with no external service.

See **[DEPLOYMENT.md](DEPLOYMENT.md)** for the deployment guide, environment
variables and provider caveats.

---

## Quick start

**Prerequisites:** Node.js 18+, MySQL 8.0+

### 1. Create the database

```sql
CREATE DATABASE inventory_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 2. Backend

```bash
cd backend
npm install
cp .env.example .env      # then edit it — see the table below
npm start                 # → http://localhost:5000
```

Tables are created automatically on first run, along with the initial admin
user, default categories and suppliers.

### 3. Frontend

```bash
cd frontend
npm install
npm start                 # → http://localhost:3000
```

### 4. (Optional) Load realistic demo data

Useful for seeing the dashboard, reports and filters with real-looking numbers.

```bash
cd backend
npm run seed:demo         # ~24 products, 6 customers, ~240 sales over 45 days
npm run seed:demo:reset   # remove and regenerate it
```

Everything it creates is tagged (`DEMO-` SKUs, `(demo)` customers, `[demo]`
notes) and the reset only removes those rows — your real data is never touched.

---

## Environment variables (`backend/.env`)

| Variable | Required | Notes |
|---|---|---|
| `PORT` | no | Defaults to 5000 |
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` | **yes** | MySQL connection |
| `JWT_SECRET` | **yes** | Must be ≥ 32 characters — the server refuses to start otherwise |
| `JWT_EXPIRES_IN` | no | Defaults to `7d` |
| `NODE_ENV` | no | `production` hides internal error details from API responses |
| `FRONTEND_URL` | no | Added to the CORS allow-list |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | first run only | Creates the initial admin. Password must be ≥ 8 characters |
| `SEED_STAFF_EMAIL` / `SEED_STAFF_PASSWORD` | no | Optional second account |

Generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

**Login credentials are whatever you set in `SEED_ADMIN_*`.** They are only used
the very first time the `users` table is empty; no password is hard-coded in the
source.

---

## Scripts

### Backend

| Command | Purpose |
|---|---|
| `npm start` | Run the API |
| `npm run dev` | Run with nodemon |
| `npm test` | Unit tests for validation and money arithmetic (no DB needed) |
| `npm run test:api` | End-to-end API suite — **needs the server running** |
| `npm run seed:demo` | Add realistic demo data |
| `npm run seed:demo:reset` | Remove and regenerate demo data |
| `npm run db:fix-indexes` | Repair database indexes (see note below) |
| `npm run migrate:check` | Check connectivity to the local and production databases |
| `npm run migrate:prod` | Copy local data into a production database (backs up first, never writes to the source) |

### Frontend

| Command | Purpose |
|---|---|
| `npm start` | Dev server |
| `npm run build` | Production build |
| `npm test` | React test runner |

---

## Modules

| Module | What it does |
|---|---|
| **Dashboard** | Today/month revenue, net profit, money owed by customers, out-of-stock and low-stock counts, stock value, 30-day sales trend, top products |
| **Point of Sale** | Barcode/QR/SKU scanning (USB scanner + camera), cart, discounts, four payment methods, credit sales, change calculation, invoice |
| **Products** | Full CRUD with images, barcode generation and label printing, search by name/SKU/barcode, category and low-stock filters, pagination |
| **Stock & History** | Inventory valuation at cost and retail, out/low-stock views, CSV export, and the full stock movement ledger |
| **Sales** | Paginated history with server-side totals, date/payment/unpaid filters, due collection, invoice and voucher PDFs |
| **Returns** | Partial returns against an invoice with optional restocking; refunds recorded in a ledger. A refund on a credit sale settles what is owed before any cash is handed back |
| **Customers** | Contacts, purchase history, outstanding balances |
| **Suppliers** | Directory with product counts |
| **Expenses** | Categorised expense tracking that feeds net profit |
| **Reports** | Profit & loss, sales chart, product-wise sales, payment-method breakdown, inventory report |
| **Users** | Admin-only user management with role-based access |

---

## The stock ledger

Every change to a stock level is written to `stock_movements` in the same
transaction as the change itself, recording the type (sale, return, purchase,
damage, recount, adjustment), the signed quantity, the level **before and
after**, a reference (invoice or return number), who did it, and when.

Nothing writes `products.stock` directly — it all goes through
`StockMovement.apply()`. That means a stock figure can always be explained, and
the ledger can be replayed to audit a discrepancy.

To change stock, use **Adjust stock** on the Products page (add / remove / set
exact count) rather than editing the number in the product form. Editing the
form still works and is still logged, but it is recorded as a `correction`.

---

## Reporting definitions

```
grossRevenue = SUM(sales.total)                     invoiced amount
totalReturns = SUM(returns.totalRefund)
revenue      = grossRevenue − totalReturns          net revenue
collected    = SUM(sales.paid)                      cash actually received
due          = SUM(sales.due)                       outstanding
cogs         = SUM((qty − returned) × cost)
grossProfit  = revenue − cogs
netProfit    = grossProfit − expenses
```

`sales.total` is set once at sale time and is never rewritten. Returns are
subtracted at query time from the return ledger, which is the single source of
truth for refunds. All date boundaries use BST (UTC+6).

### What is frozen on an invoice, and what is not

This distinction was previously stated as "invoices are never rewritten after a
return", which was misleading — `collectDue` has always mutated `paid` and
`due`.

| Field | After the sale |
|---|---|
| `total`, `subtotal`, `discount`, `discountMode`, `discountRate`, `tax` | **Frozen.** The invoice as agreed. |
| `paid` | Moves only when cash is received. Reported as `collected`. |
| `due` | Moves when a payment is collected, **and** when a refund settles a debt. |

### Returns that settle debt

A customer who bought on credit and returns the goods should stop owing for
them. So a refund clears what is outstanding on that invoice first, and only
the remainder leaves the till:

```
appliedToDue = min(totalRefund, sale.due)      -- recorded on the return
cashRefund   = totalRefund - appliedToDue      -- derived, never stored
```

A ৳100 sale with ৳70 paid and ৳30 owing, returned in full, cancels the ৳30 and
hands back ৳70. Both halves are shown on the return record and in the
customer's balance history, because a return that silently does two things is
where an argument with a customer starts.

`paid` is deliberately **not** increased to absorb the settlement. It is the
cash-taken figure `collected` reports, and inflating it to preserve the old
`paid + due == total` equation would have corrupted the one number the
shopkeeper reads every morning. The invariant changed instead — see
[Data integrity](#data-integrity).

Lock order is **sales, then customer**, identical to `collectDue`. Taking them
in the other order deadlocks a return against a payment for the same customer.

### Known gap: payments are not individually logged

`GET /customers/:id/history` returns the balance as events — a credit sale, and
a return that settled part of it. **It cannot list individual payments**, and
the response says so with `paymentsItemised: false` rather than guessing.

There is no payments table. The ledger *is* `sales.paid` / `sales.due`, so a
payment is only visible as the gap between an invoice's total and what is still
owed — you can see that someone paid ৳500 against an invoice, not that they
paid it on 12 September.

This is a deliberate deferral, not an oversight. A shopkeeper who needs to know
when someone paid can open the sale. Closing it properly means a
`customer_payments` table written by `collectDue` inside its existing
transaction, plus a backfill decision for payments already absorbed into
`sales.paid` with no date attached — those are unrecoverable, so any backfill
would be an estimate. Worth doing if it becomes a real complaint; not worth
inventing history for.

---

## Money and rounding

**There is exactly one rounding rule, and it lives in `backend/utils/money.js`:**

```js
round2(x) === Math.round(x * 100) / 100      // two decimals, half away from zero
```

Every taka figure the system stores or returns goes through `round2` — sale
totals, discounts, refunds, customer balances, report figures. Import it; do not
re-implement it.

Do not introduce a second idiom. `parseFloat(x.toFixed(2))` looks equivalent and
mostly is, but it rounds the decimal *string* rather than the number. A
September 2026 audit found it living alone in `returnController` while every
other file used `round2`. The two agreed on every value tested, which is exactly
what makes a second idiom dangerous — it is wrong rarely enough that nobody
notices.

Three rules follow:

1. **Accumulate unrounded, round once.** Three lines at 33.333 rounded
   individually give 99.99; rounding the sum gives 100.00.
2. **Round at the boundary, not at the view.** Report endpoints send their
   payload through `roundMoney()`, which rounds every non-integer number in the
   response. Before this, gross profit went out as `1606.8399999999997` and was
   only ever correct because this UI happened to round for display; the next
   consumer would have inherited the float.
3. **Split a total by largest remainder, never by rounding each share.** When
   one amount is divided across lines — a multi-line refund, say — round the
   shares down and hand the leftover paisa to the largest fractions, so the
   parts add up to the whole exactly.

### Percentage discounts

A discount can be entered as taka or as a percentage. The percentage is
resolved to taka **once, on the server**, and the taka is what gets stored:

| Column | Role |
|---|---|
| `sales.discount` | Resolved taka. **The authority** for every money calculation. |
| `sales.discountMode` | `flat` \| `percent` — what was agreed at the counter. |
| `sales.discountRate` | 0–100, set only when mode is `percent`. Provenance. |

`discountMode` and `discountRate` are **never** used to compute money. That is
deliberate, and measurable: the sale rounds at the discount while a
recomputation rounds at the total, so `subtotal × (1 − rate/100)` disagrees
with what the customer actually paid on **5.8% of sales** in the ৳100–৳5,000
range at common rates. Refunds read the stored taka, so they cannot drift.

The redundancy is checked rather than trusted — `config/dataIntegrity.js`
asserts `discount === ROUND(subtotal × rate / 100, 2)` on every percentage sale,
and runs at boot, from `GET /api/health/integrity`, and on every dashboard load.

Both modes reject rather than clamp: a rate above 100%, or a flat amount above
the subtotal, is a 400. 100% is a legitimate giveaway.

### Refunds on a discounted sale

A refund returns what the customer **paid**, not what the goods were listed at.
Each returned line carries its proportional share of the sale's discount:

```
factor = (subtotal − discount) / subtotal
```

Returns are allocated by telescoping: each return refunds the discounted value
of everything returned so far, minus what earlier returns already gave back. A
sale returned in three pieces therefore refunds exactly what was paid, with the
last return absorbing the rounding remainder rather than stranding a paisa.
Tax is deliberately outside this calculation.

---

## PDF endpoints

| Endpoint | Output |
|---|---|
| `GET /api/pdf/invoice/:id?token=JWT` | Tax invoice |
| `GET /api/pdf/voucher/:id?token=JWT` | Payment voucher |
| `GET /api/pdf/return/:id?token=JWT` | Return note |
| `GET /api/pdf/sales-report?type=daily\|monthly&token=JWT` | Sales report |
| `GET /api/pdf/sales-report?from=YYYY-MM-DD&to=YYYY-MM-DD&token=JWT` | Custom range |
| `GET /api/pdf/product-sales?from=…&to=…&token=JWT` | Product-wise sales |

These accept the JWT as a query parameter so the browser can open them in a new
tab. See the security note below.

---

## Database schema

| Table | Contents |
|---|---|
| `users` | Staff accounts (admin / staff) |
| `categories`, `suppliers` | Reference data |
| `products` | Catalogue, pricing, stock, low-stock threshold |
| `stock_movements` | Append-only ledger of every stock change |
| `customers` | Contacts, lifetime purchases, outstanding balance |
| `sales`, `sale_items` | Invoices and their line items |
| `returns`, `return_items` | Refund ledger |
| `expenses` | Business expenses |
| `product_images` | Fallback image store, used only when Cloudinary is not configured |

### Note on indexes

`sequelize.sync()` re-issues `ADD UNIQUE INDEX` on every boot, and MySQL creates
a new index each time (`email`, `email_2`, `email_3`, …). Left alone a table
walks toward MySQL's hard limit of **64 keys**, after which startup fails
permanently. This audit found `users` already carrying 41 duplicate indexes on
`email`, `products` 27 on `sku`, and `sales` 26 on `invoiceNo`.

The server now collapses these duplicates on every boot and adds the indexes the
reporting queries need. Run it manually with `npm run db:fix-indexes` — useful
if a table has already hit the ceiling and the app will not start.

### Changing the schema: `server.js` does not run in production

**On Vercel the boot sequence never executes.** The API is a serverless
function: `api/index.js` requires `backend/app.js` directly, so everything
`server.js` does on the way up — `sync()`, `dedupeIndexes`, `ensureIndexes`,
`ensureColumns`, the integrity report — is absent from the deployment that
holds the real data. Locally all of it runs on every `npm run dev`, which is
exactly what makes this easy to miss: the schema keeps up with the models on
your machine and silently does not in production.

Two consequences:

1. **A column added to a model never reaches production by itself.** Deploying
   code that writes a new column to a database that lacks it fails on the first
   write, on real data, with `Unknown column`. This was caught once already —
   `sales.discountMode` and `sales.discountRate` existed locally and not on
   production TiDB, one push away from breaking every sale.
2. **Schema can only move forward from outside**, which is what
   `scripts/migrateSchema.js` is for.

So when you add a column to a model, add it to `config/ensureColumns.js` and to
`EXPECTED` in `scripts/migrateSchema.js`, then:

```bash
cd backend
npm run migrate:schema:check   # read-only: reports drift, changes nothing
npm run migrate:schema         # applies it; idempotent, additive only
git push                       # only now — the push is the deploy
```

The same reasoning is why the standing data check
(`config/dataIntegrity.js`) is wired into the dashboard request path and not
only into boot: a boot-time check would cover local development and be missing
from production entirely. See [Data integrity](#data-integrity).

---

## Security

- JWT authentication on every API route; bcrypt password hashing (12 rounds)
- Role-based access — user management, product archiving and restore are admin-only
- Login is rate-limited (20 attempts / 15 min); the whole API is limited to 600 req/min
- Login responses are identical for unknown, disabled and wrong-password accounts, so the endpoint cannot be used to enumerate valid users
- The last active admin cannot be demoted or deactivated, and no admin can lock themselves out
- Server-side validation on every write path — frontend validation is treated as a convenience only
- Parameterised queries throughout (Sequelize); no string-built SQL
- Internal error details and stack traces are suppressed when `NODE_ENV=production`
- `.env` is git-ignored; `.env.example` carries placeholders only

**Known trade-off:** PDF links pass the JWT in the query string so they can be
opened in a new tab. Query strings can appear in browser history and server
access logs. On a shared machine, prefer short `JWT_EXPIRES_IN` values. Moving
to short-lived single-use download tokens would remove this.

---

## Data integrity

`backend/config/dataIntegrity.js` holds the checks that must be true forever and
that normal use would never reveal: percentage discounts matching their stored
rate, totals equalling subtotal − discount + tax, no sale refunded beyond its
value, no negative stock or negative due, no return settling more debt than it
refunded, and cached customer balances matching their unpaid invoices.

### One invariant was deliberately redefined

```
was:  paid + due == total
now:  paid + due + SUM(returns.appliedToDue for that sale) == total
```

When a refund began settling debt, `due` started falling without `paid` rising,
and the old equation stopped being true. The alternative — inflating `paid` to
preserve it — was rejected: `paid` is the cash-taken figure `collected`
reports, so that would have traded a correct report for a tidy equation.

The new form is stronger, not weaker. There are three ways money leaves an
invoice — cash received, still owed, and debt cancelled by a return — and the
equation now names all three instead of pretending there are two.

**Old rows are unaffected.** `appliedToDue` defaults to 0, so the sum term
vanishes and the assertion reduces to exactly the previous equation. No
backfill was needed: at the time of the change, production held 245 sales and
3 returns, and none of those returns was against a sale with anything
outstanding.

A database that predates the column is still checked, in its old form, rather
than being reported clean because a check could not run.

A test suite catches drift the day someone runs it. These run:

| Where | Scope | Why |
|---|---|---|
| boot (`server.js`) | all history | long-lived deployments |
| `GET /api/health/integrity` | all history | on demand, or from a scheduler |
| dashboard load | current month | **the one that catches drift six months from now** — it runs where the shopkeeper already looks every morning |

The dashboard variant is bounded to a date range and every column it touches is
indexed, so it is cheap enough to run on every load. On Vercel the API is a
serverless function and `server.js` never runs, which is precisely why the check
could not live at boot alone.

## Testing

```bash
cd backend
npm test              # 18 unit tests — validation rules and money arithmetic
npm start             # in one terminal
npm run test:api      # in another: 70 end-to-end API checks
                      # reads the admin password from .env; no credential is
                      # hard-coded in the test file
```

The API suite covers authentication and authorisation, validation on every write
path, sale and return arithmetic, stock deduction and restocking, the movement
ledger reconciling before/after values, concurrent-oversell protection, and
destructive-delete guards. It creates its own test data and cleans up after
itself, so it is safe to run against a database with real data in it.
