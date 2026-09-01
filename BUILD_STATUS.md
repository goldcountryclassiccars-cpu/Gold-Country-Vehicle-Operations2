# Build Status

Last updated: 2026-09-01 (Phases 1-8 complete — MVP feature-complete)

## Completed features

- Repository scaffold (Next.js 15 / TypeScript strict / Tailwind 4 / Prisma 6)
- PostgreSQL 16 (docker-compose for local use; cloud dev environment runs a local cluster)
- **Phase 1 — Foundation (verified)**: self-hosted credential auth with DB sessions,
  data-driven RBAC (roles → resource/action/scope grants + sensitive-field grants),
  authorization engine + sanitizers, permission-generated navigation, owner
  "Preview as Role", append-only audit, login/dashboard screens, seeds
  (8 departments, 10 roles, 12 demo users), 19 authz unit tests.
- **Phase 2 — Vehicle domain (verified)**: Vehicle / VehicleIdentifier (no VIN-format
  constraints) / InventoryEpisode with six parallel status enums / StatusChange
  append-only history / Arrangement (confidential economics behind field grants) /
  AcquisitionSource / Location / Party / RelatedItem / IntakeRecord / FileObject models
  and migration; episode services (stock-number generation, validated status transitions
  with history + audit, price changes with history); computed display stage; screens:
  Vehicles list + search, New vehicle (vehicle + first episode + confidential terms
  gated by field grants), Vehicle detail (specs, identifiers, episodes), Episode detail
  (six status dimensions with change forms, price update, sanitized confidential
  arrangement, intake summary, history timeline), Intake form (draft/complete; completion
  sets custody ON_SITE + location event), Pipeline board grouped by computed stage;
  Phase 2 seed (11 acquisition sources, 6 locations, 3 parties, 4 demo vehicles/episodes
  across the pipeline, one completed intake); 7 stage unit tests + 6 integration tests
  (episode lifecycle against the real DB).

Verified end to end: owner sees confidential arrangement; assigned salesperson sees the
episode with zero confidential content; unassigned mechanic gets 404. `npm run lint`,
`npm run typecheck`, `npm test` (32/32), and `npm run build` all clean.

- **Phase 3 — Workflow (verified)**: Task / Comment (internal vs. vendor-visible) /
  Inspection + InspectionFinding / WorkOrder (guarded status transitions) / Approval
  models and migration; services with audit on every mutation; screens: My Work
  (tasks + inspections + work orders scoped to the signed-in user, inline task
  creation for managers), Inspections (schedule, findings with severity + est. cost,
  one-click work order from a finding, complete), Work Orders (queue, detail with
  guarded transitions, approval request, comments with vendor visibility), Approvals
  (pending queue with approve/decline + recent decisions); app-section error boundary
  for unauthorized access; Phase 3 seed (inspection w/ 2 findings incl. safety, brake
  work order awaiting approval, vendor work order in progress, 3 tasks, comments);
  8 workflow integration tests (40 tests total).

Verified: mechanic sees dept inspection + assigned task/WO; vendor sees ONLY their
work order and no internal comments; owner approves from the approvals queue;
mechanic blocked from /approvals.

- **Phase 4 — Financial ledger & profitability (verified)**: ExpenseCategory /
  ExpenseEntry (estimated → submitted → approved/declined → committed → incurred →
  paid → reimbursed, void from any non-terminal state; per-entry financial
  responsibility incl. consignor and buyer pass-through; distinct estimate/approved/
  committed/actual amounts) / ProfitSnapshot models; completed work orders post
  automatically into the ledger; profitability computed live from ledger +
  arrangement (consignment dealer-share via guaranteed net or commission structure;
  acquisition cost only for dealer-owned), immutable snapshot at close (duplicate
  refused); /expenses ledger screen (create, lifecycle transitions, approve/decline)
  and /profitability screen (gated by profitability:view AND the profit field grant;
  acquisition column additionally gated); Phase 4 seed (9 categories, 8 demo
  expenses); 5 finance integration tests (45 total).

Verified: owner sees ledger + profitability with projected badges; mechanic blocked
from both; work-order completion writes an INCURRED expense.

- **Phase 5 — Media, listings, integration outbox (verified)**: MediaAsset +
  configurable MediaChecklistItem (readiness computed from coverage per category);
  real multipart upload endpoint through the storage adapter (type/size validated,
  sha256, audit) and permission-checked file download endpoint (sensitive files also
  require the matching field grant; storage keys never exposed); computed listing
  readiness (specs, primary identifier, intake complete, reconditioning resolved,
  no unaddressed safety findings, required media, price); submit-to-listing flow
  (marketing status + atomic outbox event); IntegrationEvent outbox with idempotency
  keys; authenticated listing-app API (Bearer LISTING_API_KEY): GET events, POST
  ack, GET authoritative episode data (public listing fields only); /api/health;
  screens /media (queue + checklist + upload + asset grid + archive), /listings
  (readiness checks + submit), /integrations (outbox viewer + API docs); Phase 5
  seed (9 checklist items, 6 placeholder photos for GC-1001); 4 media/outbox
  integration tests (49 total).

Verified: media grid renders via authorized downloads (200 for owner, redirect for
anonymous); integration API returns 401 without the bearer key and events with it.

- **Phase 6 — Sales, payments, closing, documents (verified)**: SaleTransaction
  (deposit → contracted → funded → released → delivered; canceled/unwound deals
  preserved and the vehicle returns to AVAILABLE) / Payment (kind, method, status;
  cleared payments auto-advance the deal + episode) / DocumentTemplate +
  DocumentInstance (versioned, watermarked demonstration PDFs via pdf-lib, stored
  with signed_docs sensitivity; mock e-sign send → signed → filed); release gate
  (funded + all docs signed) bypassable ONLY by a real owner with an audited
  reason; delivery marks sold + emits the vehicle.sold outbox event; profitability
  now uses the real deal price over asking; screens /sales (+deal detail with
  sanitized buyer PII, payments, documents, gate/release/deliver/cancel),
  /closing desk, /documents; Phase 6 seed (5 demo templates, active deal on
  GC-1003 with cleared deposit); 6 sales integration tests (55 total).

Verified: full lifecycle in tests (deposit→funded→signed→released→delivered→
vehicle.sold event); non-owner blocked from gated release; owner override audited;
canceled deal preserved with vehicle back to AVAILABLE; buyer PII filtered by grant.

- **Phase 7 — Transport, consignments, settlements, archive (verified)**:
  TransportJob (quote → booked → in transit → delivered with guarded transitions;
  outbound movement drives the custody dimension; delivered cost posts to the
  ledger — outbound as buyer pass-through) / Settlement (computed from sale +
  arrangement commission/guaranteed-net + consignor-responsibility chargebacks;
  configurable deadline via settlement_deadline_days AppSetting; pending-approval →
  approved → paid, each advancing the financial-close dimension) ; financial close
  requires a paid settlement for consignments, captures the immutable profit
  snapshot, and deactivates the episode; screens /transport, /settlements
  (generate/approve/pay/close), /consignments (terms gated by field grants),
  /archive (permanent sold record; final net gated by profit grant); 4 settlement
  + transport integration tests (59 total).

Verified: transport role reaches /transport but is blocked from /settlements;
settlement math (10% w/ minimum + chargebacks) and close-with-snapshot covered by
tests; consignments screen shows terms only with the consignor_terms grant.

- **Phase 8 — Reports, administration, notifications (verified)**: in-app
  Notification model + service (email via the dev log adapter; content kept
  minimal — no sensitive fields), wired into approval requests (→ owners),
  approval decisions (→ requester), task assignment (→ assignee), and settlement
  generation (→ owners); /notifications page + sidebar unread badge; /reports
  (KPI row: active inventory by stage, pipeline value, average age, net profit
  gated by the profit grant; acquisition-source performance bar list — net
  contribution per source with counts; inventory aging table flagging 90+ days);
  /admin (user management: create, disable-with-immediate-session-destruction,
  password reset; roles overview with reset-to-template; settings: stock-number
  prefix/counter + settlement deadline days); /admin/audit append-only log viewer
  with filtering.

## Deferred features (post-MVP backlog)

- Fine-grained per-grant role editing UI (grants are data; reset-to-template
  ships now).
- Reacquisition flow UI (new episode for an existing vehicle; model supports it).
- SMTP email and a production e-signature provider (adapter interfaces are in
  place; development uses log/mock). S3-compatible storage is now implemented
  and covered by tests — see DEPLOYMENT.md.
- Playwright e2e suite (config present; unit + DB integration suites cover the
  engine and services — 64 tests).
- Production hardening: Redis-backed rate limiting, CSRF review, backup policy.

## Known limitations

- New-episode-for-existing-vehicle (reacquisition) flow not yet exposed in the UI
  (model supports it; episode creation is currently part of New vehicle).
- Assignment model uses episode salesperson/operations owner; task/work-order-level
  assignment arrives with Phase 3.

## Required external credentials

- None for local development (all integrations use development adapters/mocks)
- GitHub repository URL + access (for hosting the code; requested from Jade)

## Required business or legal decisions

- Sales-document configuration — see `SALES_DOCUMENT_SETUP.md`
