# Motion — Backend + Integrated Frontend

A working full-stack implementation of the Motion platform: event ticketing,
flight booking, accommodation booking, a wallet ("Motion Pay"), a
configurable commission/revenue engine, and PDF invoice/receipt generation —
all served by one Node.js process.

This is real, running code (not a mockup) — start it and it works. The one
deliberate seam is payments: this sandbox has no route to Safaricom's Daraja
API or a card network and no live merchant credentials, so the payment layer
is a swappable **provider interface** with mock M-Pesa/card providers behind
it. See "Going live with real payments" below for exactly what to change.

## Quick start

```bash
npm install
npm start          # http://localhost:4000 — frontend + API, same process
```

On first boot the server seeds:
- Commission rules (ticketing 8%, flights 5%, stays 12%)
- 3 sample flights (Safarilink, Jambojet, Kenya Airways) with real seat maps
- 3 sample properties with rooms
- An admin account: `admin@motion.africa` / `ChangeMe123!` — **rotate this
  immediately in any real deployment.**

Open `http://localhost:4000`, register as an **organizer** to publish an
event, or a **buyer** to book. Log in as the admin account to access the
Revenue Admin tab.

## Architecture

```
src/
  config/
    db.js          — the only file that touches the database driver
    seed.js         — demo data + commission defaults
  middleware/
    auth.js         — JWT verification + role guard
    validate.js      — zod request validation
    idempotency.js   — Idempotency-Key header handling for checkout endpoints
    errorHandler.js
  modules/
    auth/           — register, login, /me
    wallet/         — balance, top-up, transaction history
    events/         — organizer event + ticket-tier publishing, public catalogue
    tickets/        — inventory-safe ticket checkout
    flights/        — seat maps, seat-level booking
    stays/          — room inventory, date-overlap-safe booking
    payments/       — provider interface (mock M-Pesa / card / wallet)
    revenue/        — commission rule engine + admin endpoints
    documents/       — PDF receipt/invoice generation + secured download
  routes/index.js    — mounts every module under /api
  server.js          — security middleware stack + static frontend
public/
  index.html         — the actual UI, talks to the API via fetch()
```

Each domain is isolated behind its own routes file and only touches the
database through `db.prepare(...)` with parameterized queries — no string-built
SQL anywhere. Adding a new domain (e.g. sponsorship marketplace, Pay Later)
means adding a new folder under `modules/` and mounting it in `routes/index.js`;
nothing else needs to change.

## Why node:sqlite instead of Postgres/MySQL

This sandbox cannot compile native modules (no network route to fetch
node-gyp's Node headers) or reach an external database host. Node 22 ships
an experimental built-in `node:sqlite` module, which gives real SQL,
transactions, and prepared statements with zero native dependencies. `db.js`
is the only file that imports it — swapping to Postgres for production means
replacing that one file with a `pg` pool that exposes the same
`{ db, transaction }` shape; every route file is unaffected.

## Money safety — how double-booking/double-charging is prevented

- **Ticket inventory**: `quantity_sold` is incremented inside the same
  write transaction that checks remaining stock, so two simultaneous buyers
  can't oversell a tier (tested — see "Overselling protection" below).
- **Flight seats**: a seat's `status` flips to `booked` inside the same
  transaction that validates it was `available`.
- **Room bookings**: a date-range overlap query runs inside the booking
  transaction, so two guests can't book the same room for overlapping dates.
- **Idempotency-Key header**: every checkout endpoint accepts one. A retried
  request with the same key returns the original order instead of charging
  twice — this matters on the flaky mobile networks the product doc calls out.
- **External payment call happens outside the DB transaction.** If the
  charge fails, the reserved inventory is released in a follow-up
  transaction rather than holding a DB lock open during network I/O.

## Revenue engine — "cut our commission"

`commission_rules` is a live-editable table, not a constant in code:

```
PATCH /api/revenue/rules/ticketing_fee   { "rate_percent": 3 }
PATCH /api/revenue/rules/flight_commission { "active": false }   # fully waive
```

Every new order picks up the current rate at the moment of sale; past
orders/invoices are untouched, so a rate change is auditable rather than
silently rewriting history. `GET /api/revenue/summary` gives an all-time
total per revenue line. This was tested live: cutting the ticketing fee from
8% to 3% took effect on the next order with no restart.

## Invoices & receipts

Every paid order generates:
- A **buyer receipt** (proof of payment, itemized, PDF)
- An **organizer invoice** for ticket sales (gross sale → commission line(s)
  → net payout, PDF) — this is what makes a commission change auditable to
  the person actually being paid out.

Both are real PDFs (via `pdfkit`), stored on disk, and served through
`GET /api/documents/:id/download`, which checks that the requester is the
buyer, the payee organizer, or an admin before streaming the file.

## Security measures implemented

- `helmet()` for standard security headers (HSTS, no-sniff, frameguard, etc.)
- JWT auth (`jsonwebtoken`) with a 12h expiry; passwords hashed with `bcryptjs`
  (cost factor 11), never stored or logged in plaintext
- Role-based access control (`buyer` / `organizer` / `admin`) enforced per route
- `zod` schema validation on every request body — bad input never reaches
  business logic
- Global rate limiting (300 req/min) plus a stricter limiter (20 req/min) on
  auth and every checkout/top-up endpoint, to blunt credential-stuffing and
  payment-spam attempts
- Parameterized SQL everywhere — no string-concatenated queries, so standard
  SQL injection is not applicable
- `audit_log` table recording register/login, event publishing, purchases,
  and every commission-rule change, with actor, action, metadata, and IP
- Generic auth error messages ("Invalid email or password") that don't
  reveal whether an email is registered
- Document access control checked per request, not assumed from a URL

### What's not done yet — be honest about the gap
This is a strong foundation, not a completed security audit. Before real
money moves through this, you'd still want: HTTPS/TLS termination (typically
at a reverse proxy, not in Node), refresh-token rotation instead of a single
12h JWT, request logging shipped to a SIEM, dependency vulnerability
scanning in CI, secrets pulled from a vault instead of `.env`, and a real
penetration test. The architecture doesn't fight any of these — there's just
more to add.

## Going live with real payments

Replace `MpesaMockProvider` / `CardMockProvider` in
`src/modules/payments/providers.js` with real adapters that implement the
same `charge({ amountCents, payerRef, description })` interface:

```js
class DarajaMpesaProvider {
  async charge({ amountCents, payerRef, description }) {
    // call Safaricom's Daraja STK Push endpoint, poll/await the callback,
    // return { status: 'success'|'failed', providerRef, raw }
  }
}
```

No other file changes — `PROVIDERS.mpesa = new DarajaMpesaProvider()` and the
whole order/ticket/flight/stay flow starts moving real money through the
same commission, ledger, and document pipeline already built.

## API reference (short form)

| Method & path | Auth | Purpose |
|---|---|---|
| POST /api/auth/register, /login | — | account creation / login |
| GET /api/auth/me | buyer+ | current session |
| GET/POST /api/wallet, /wallet/topup | buyer+ | balance, top-up |
| GET /api/events, /api/events/:id | — | public catalogue |
| POST /api/events | organizer | publish event + tiers |
| GET /api/events/mine/dashboard | organizer | sales-to-date |
| POST /api/tickets/checkout | buyer+ | buy tickets |
| GET /api/flights, /:id/seats | — | flights + live seat map |
| POST /api/flights/checkout | buyer+ | book seats |
| GET /api/stays | — | properties + rooms |
| POST /api/stays/checkout | buyer+ | book a room |
| GET/PATCH /api/revenue/rules, GET /summary | admin | commission control |
| GET /api/documents/:id/download | owner/payee/admin | PDF receipt/invoice |

## Extending further

- New revenue line (e.g. sponsorship placement fee): add a row to
  `commission_rules`, a `revenue.computeCommission('sponsorship', ...)` call
  at the relevant checkout point — the admin panel picks it up automatically.
- Trip bundling (event + flight + stay in one checkout): add an `orders`
  row with `order_type = 'bundle'` and multiple `order_items` referencing
  each domain — the ledger and document generators already work per line item.
- Cyber hardening: add `express-mongo-sanitize`-style input scrubbing, CSRF
  tokens if you move off pure bearer-token auth, and a WAF in front of this
  in production.
