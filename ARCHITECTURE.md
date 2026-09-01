# Architecture

## Overview

GCCC Ops is a **modular monolith** built on Next.js (App Router) with PostgreSQL via
Prisma. All domain logic lives in `src/modules/<domain>` behind plain TypeScript service
functions; Next.js route handlers, server components, and server actions are thin layers
that authenticate, authorize, validate, and delegate to modules. There are no
microservices, message brokers, or orchestration infrastructure.

```
src/
  app/            Next.js App Router — pages, layouts, API routes (thin)
  components/     Shared UI kit (accessible, Tailwind-based)
  lib/            Cross-cutting: db client, auth, authz, storage, email, config
  modules/        Domain modules (vehicles, episodes, intake, tasks, inspections,
                  work-orders, expenses, media, listings, sales, documents,
                  transport, settlements, reporting, notifications, integrations,
                  audit, admin)
prisma/           Schema, migrations, seed
tests/            unit / integration / e2e (Playwright)
```

## Major decisions

### 1. Permanent Vehicle vs. Inventory Episode vs. Sale Transaction

A physical **Vehicle** is permanent and can pass through the dealership multiple times.
Each period of possession/marketing is an **InventoryEpisode** (with its own stock number,
statuses, economics, and arrangement). Each attempted or completed sale is a
**SaleTransaction** on an episode. All primary keys are immutable UUIDs; the VIN is never
a primary key. This directly supports reacquisition, canceled/unwound sales followed by
new sales, and repeat consignments.

### 2. Classic-car identifiers

`VehicleIdentifier` is a separate table: type (VIN, short VIN, chassis, serial, engine,
body, cowl tag, other, unknown/pending), value, primary flag, verification status, and
supporting media. No 17-character constraint exists anywhere. A vehicle may have many
identifiers.

### 3. Parallel status dimensions

An episode carries six independent status fields — custody, reconditioning, marketing,
sales, document, and financial closing — each an enum with its own history in
`StatusChange` rows. A simplified display stage for dashboards is **computed** from these
(never stored as the source of truth).

### 4. Financial ledger, not totals

Every cost is an `ExpenseEntry` with distinct estimated / approved / committed / actual
amounts, a lifecycle status (estimated → submitted → approved/declined → committed →
incurred → paid → reimbursed / voided), financial responsibility (dealership, consignor,
buyer pass-through, shared, reimbursable, pending), receipt attachments, and audit
history. Profitability is always computed from ledger entries; final profit is preserved
as an immutable `ProfitSnapshot` at financial close.

### 5. History is preserved

Status changes, price changes, assignment changes, approvals, and document versions are
append-only. Finalized records are corrected through adjustments/amendments, not
destructive edits. Business records use archival (soft delete), never hard deletes.
An append-oriented `AuditEvent` table records actor, acting role, action, resource,
before/after values, reason, and source.

### 6. Authentication: self-hosted credential auth with database sessions

We implement a small, fully self-hosted auth module (`src/lib/auth`) rather than wiring
Auth.js around a credentials provider:

- bcrypt password hashing (cost 12)
- opaque session tokens (32 random bytes), stored hashed (SHA-256) in a `Session` table
- httpOnly, SameSite=Lax, Secure-in-production cookie
- absolute expiration (configurable TTL) + disabled-user checks on every request
- multiple roles per user; permissions resolved server-side per request

Rationale: Auth.js's credentials flow forces JWT sessions and obscures the exact
revocation/disabled-user semantics this system requires (immediate lockout, auditability).
The module is ~300 lines, testable, and leaves clean seams for future MFA (a
`mfaEnrolled` flag and challenge step) and SSO (an `Account` table can be added and the
session layer reused unchanged).

### 7. Authorization: central policy engine

All authorization flows through `src/lib/authz` (see `PERMISSIONS.md`):

- `getSessionUser()` — authenticated user + resolved role/permission set (union across roles)
- `authorize(user, action, resource, record?)` — action + record-scope decision
- `canViewField(user, fieldKey)` / `sanitize<Entity>ForUser()` — field-level filtering
  applied before data leaves the server (API responses, RSC props, exports, search,
  notifications)
- `requirePermission(...)` / `requireOwnerOverride(...)` — throwing guards for mutations

Roles and their permission grants are **data** (seeded, editable in Administration), not
code. Navigation is generated from the resolved permission set; unauthorized modules are
absent, not disabled.

### 8. Adapters for anything external

Storage (`local` dev / S3-compatible interface), email (`log` dev adapter), e-signature
(mock adapter implementing create/send/status/download/cancel), and the listing
integration (outbox table + documented REST API + mock webhook receiver) are all behind
interfaces in `src/lib/adapters`. Local development never requires paid services or real
credentials.

### 9. Integration outbox

Outbound events (`vehicle.listing_ready`, `vehicle.sold`, …) are written to an
`IntegrationEvent` outbox row in the same transaction as the business change, with
idempotency keys, attempt counts, and delivery status. The future listing application
pulls via authenticated API (or a delivery worker pushes later); duplicate retries cannot
create duplicate events because the idempotency key is unique.

### 10. Configuration over hardcoding

Departments, locations, expense categories, acquisition sources, task/inspection
templates, media checklists, approval thresholds, release requirements, settlement
deadlines, price-review intervals, stock-number format, and document rules are all
database-backed configuration editable in Administration. Secrets come from environment
variables only.

## Stack

| Concern    | Choice                                    |
|------------|-------------------------------------------|
| Framework  | Next.js 15 (App Router), React 19, TS strict |
| Styling    | Tailwind CSS 4 + small custom accessible component kit |
| Data       | PostgreSQL 16, Prisma 6, versioned migrations |
| Validation | Zod at every boundary                     |
| Tables     | TanStack Table                            |
| Charts     | Recharts                                  |
| PDFs       | pdf-lib (demonstration documents)         |
| QR codes   | qrcode                                    |
| Tests      | Vitest (unit/integration), Playwright (e2e) |
