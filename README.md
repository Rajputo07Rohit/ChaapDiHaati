# Chaap Di Haati — Restaurant Management System

A production-grade restaurant management system for Chaap Di Haati: POS, kitchen display, inventory with recipe-based costing, purchases, expenses, cash & bank ledgers, daily closing, profit & loss, reports, staff/payroll, audit logging, and backups.

This is a real accounting system, not a demo dashboard. Every financial number is computed from actual transaction rows and is traceable back to them. Money is stored as **integer paise** everywhere — never floating point.

## Architecture

```
React + Vite + TypeScript + Tailwind   (frontend/)
              ↓  REST over HTTPS/cookies
Node + Express + TypeScript            (backend/)
              ↓
SQLite + better-sqlite3, WAL mode, foreign keys on
```

The frontend never touches SQLite. Every stock, sales, purchase, expense and financial calculation goes through a backend service function, and every one of those functions that mutates money or stock runs inside a single `db.transaction(...)` — if any step fails, the whole operation rolls back.

### Backend layout

```
backend/src/
  db/
    migrations/0001_init.sql   # full schema (28 tables), applied by migrate.ts
    connection.ts              # the one better-sqlite3 instance, WAL + FK on
    migrate.ts / seed.ts / reset.ts
  modules/<domain>/
    <domain>.service.ts        # business logic + SQL, the only place money math happens
    <domain>.routes.ts         # Express router, Zod validation, RBAC middleware
  middleware/                  # auth (JWT in httpOnly cookie), RBAC, error handler
  utils/                       # money (paise helpers), audit log writer, units, business-date guard
  routes/index.ts              # mounts every module router under /api
```

### Frontend layout

```
frontend/src/
  api/           # typed fetch client + shared types
  context/       # auth context (session via httpOnly cookie)
  components/    # Layout (sidebar/topbar) + shared UI primitives
  pages/         # one file per nav section (Dashboard, POS, Orders, Kitchen, Menu, ...)
```

## Core accounting rules encoded in the system

- **Sales ≠ Revenue ≠ COGS ≠ Expenses ≠ Profit ≠ Cash balance ≠ Bank balance ≠ Stock value.** These are computed separately and never conflated. Profit is never `sales − purchases`.
- **Purchase ≠ Expense ≠ COGS.** A purchase increases inventory and (if paid) reduces cash/bank. COGS is only recognized when a recipe is consumed by a completed sale. An expense is an operating cost, not automatically linked to inventory.
- **Cancelled orders are never counted as sales.** Refunds are separate reversal transactions — the original completed sale is never deleted or edited.
- **Historical integrity.** Menu price changes and recipe changes create new *versions* with an `effective_from`/`effective_to` window. A completed order always resolves to the price/recipe that was in effect when it was created — changing a price today never rewrites yesterday's COGS.
- **Stock is derived from movements**, never overwritten. `inventory_movements` is the ledger; `inventory_items.current_qty_base` is a cache kept in sync inside the same transaction as each movement.
- **Negative stock requires an explicit Admin override with a reason** (`recordMovement(..., allowNegativeStock: true)`); everyone else gets a hard validation error.
- **Every financial mutation writes an `audit_logs` row** (append-only, no API to edit/delete it) inside the same transaction as the change it describes.
- **Closed business days are frozen** for MANAGER/STAFF; only ADMIN can write into a closed day (and reopening one is itself audited with a required reason).
- **Discrepancies are stored, never silently corrected.** Daily closing requires an explicit reason whenever counted cash differs from the system-expected figure, and the difference is saved as-is.

## Getting started

```bash
# from the repo root
npm install                 # installs both workspaces
npm run migrate             # creates backend/data/chaapdihaati.db and applies schema
npm run seed                # loads menu, inventory, recipes, and the historical Sept 2026 data
npm run dev                 # runs backend (:4000) and frontend (:5173) together
```

Then open **http://localhost:5173**.

Individual workspace commands (run from `backend/` or `frontend/`):

```bash
npm run dev       # backend: tsx watch; frontend: vite
npm run build     # backend: tsc; frontend: tsc -b && vite build
npm run test      # backend only: vitest
npm run reset     # backend only: deletes the SQLite file (re-run migrate+seed after)
```

### Demo credentials (seeded)

| Role    | Username | Password    |
|---------|----------|-------------|
| Admin   | admin    | Admin@123   |
| Manager | manager  | Manager@123 |
| Staff   | staff    | Staff@123   |

### Environment

Copy `backend/.env.example` to `backend/.env` (done automatically the first time; edit as needed):

```
PORT=4000
DATABASE_PATH=./data/chaapdihaati.db
JWT_SECRET=change-this-to-a-long-random-string-in-production
CORS_ORIGIN=http://localhost:5173
```

Never commit a real `JWT_SECRET`. The frontend talks to the backend through Vite's dev proxy (`/api` → `:4000`), so cookies work same-origin in development without extra CORS configuration.

## What the seed data represents — and its honesty policy

The seed script (`backend/src/db/seed.ts`) loads every number given in the original business brief: the full menu and its prices, known raw-material costs, the 8 Sept 2026 stock snapshot, the 4–10 Sept daily sales figures, the 9 & 10 Sept purchase bills, and the bank statement reconciliation for that week.

Three deliberate choices, all called out in code comments and in the data itself:

1. **"PRICE PENDING" items are left with no cost**, never a guessed one — visible in Inventory and Reports until an Admin enters a real purchase price.
2. **Some menu items (Paneer Tikka, Chaap/Paneer Rolls, Combos) have no recipe.** The brief gives ingredient unit costs but never the per-plate quantity, and inventing one would be fabricated financial data. Their sales still work; COGS shows as unavailable and is flagged in the audit log until a real recipe is entered on the Menu page.
3. **8 Sept 2026's numbers don't add up, and the seed doesn't force them to.** The reported net sales (₹8,879) doesn't equal the Cash+Paytm+Swiggy breakdown (₹8,877). The system uses the itemized payment breakdown as the source of truth (that's what real money movements are) and records the ₹2 gap in the order's notes rather than editing either figure. The same policy applies to the 10 Sept cash count (reported ₹7,950 vs. system-expected — the difference is stored on that day's closing record with a reason, not zeroed out).

Run `npm run seed` and read its console output — it prints the MTD figure computed bottom-up from daily records alongside the brief's "confirmed" MTD, so you can see this in action immediately.

## Testing

```bash
cd backend && npm run test
```

`backend/tests/core.test.ts` exercises the business logic directly against a throwaway SQLite file (not mocks): the three worked accounting examples from the brief, discount/payment validation, split payments, cancellation vs. refund semantics, weighted-average costing, negative-stock blocking and override, recipe-based COGS at sale time, historical price immutability, and closed-day write permissions.

## Known limitations / next steps

- Inventory costing is weighted-average only; the schema and movement model (`inventory_movements` as an append-only ledger) support adding FIFO later without a redesign.
- The Daily Closing screen presents one consolidated review rather than a literal 8-step wizard — all the same figures (sales, payments, expenses, purchases, cash, bank, stock) are shown together before closing.
- Backup restore requires a process restart (the running Node process holds one open SQLite handle); the restore endpoint copies the file and exits the process, restart it manually or via a process manager in production.
- CSV/Excel/PDF export buttons are not wired up in the Reports UI yet — every report is available as JSON from `/api/reports/*` and renders as a table in the UI.
