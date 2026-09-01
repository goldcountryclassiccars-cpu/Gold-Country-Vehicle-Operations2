# Permissions

## Model

Authorization combines four layers, all enforced **server-side** in
`src/lib/authz` before any data leaves the server:

1. **Role-based permissions** — each role holds rows of
   `(resource, action, scope)`. A user's effective permissions are the union of
   their roles' grants (the strongest scope wins per resource/action). Roles and
   grants are data (editable in Administration), not code.
2. **Record scopes** — every grant carries a scope:
   `ALL` (every record), `DEPARTMENT` (records tied to the user's departments,
   plus records assigned directly to the user), `ASSIGNED` (records assigned to
   the user or their vendor party), `OWN` (records the user created or is
   assigned to), `NONE`. List reads are filtered by scoped where-clauses;
   record reads/mutations re-check the specific record.
3. **Sensitive-field grants** — separately protected field categories are
   removed from server responses unless the role holds the field grant.
4. **Record state and owner override** — workflow gates (e.g., vehicle release)
   can only be overridden by a real owner with a recorded reason, and every
   override is audited. A previewed owner role never qualifies.

## Resources and actions

Resources: `vehicles, episodes, intake, locations, parties, tasks, comments,
inspections, work_orders, approvals, expenses, profitability, media, listings,
sales, payments, documents, transport, consignments, settlements, reports,
archive, notifications, integrations, audit, admin`

Actions: `view, create, edit, assign, approve, complete, reopen, archive,
export, generate, send, delete_draft, override_gate, manage_config`

## Sensitive field categories

`acquisition_cost, consignor_terms, min_price, profit, owner_notes, seller_pii,
buyer_pii, payment_info, title_docs, id_docs, signed_docs, banking, commissions,
compensation, accounting_refs`

These are never returned by APIs, embedded in server-rendered pages, included in
exports or search results, or attached to notifications for users without the
grant. Sanitizers (`stripFields`, per-entity `sanitize*ForUser`) run before data
serialization.

## Default roles

| Role | Primary experience | Record scope highlights | Field grants |
|------|--------------------|--------------------------|--------------|
| **Owner / Administrator** (Jade, Sergio) | Everything | ALL on every resource | All |
| **Operations Manager** | Workflow, intake, custody, tasks, inspections, work orders, media readiness | ALL on operational resources; department reports | seller_pii |
| **Mechanic** | My Work, mechanical queue, inspections, work orders | ASSIGNED vehicles; DEPARTMENT inspections/work orders | none |
| **Detailer** | My Work, detailing queue, checklists | ASSIGNED vehicles; DEPARTMENT work orders | none |
| **Body & Paint** | My Work, body queue, estimates, work orders | ASSIGNED vehicles; DEPARTMENT inspections/work orders | none |
| **Media / Marketing** | Media queue, listing readiness, asset library | ALL vehicles (field-filtered); ALL media | none |
| **Salesperson** | Available inventory, my deals, buyers, closing tasks | ALL vehicles; ASSIGNED deals/buyers/payments/documents | buyer_pii (own deals) |
| **Finance / Title** | Closing desk, payments, documents, titles, settlements | ALL on financial/closing resources | buyer_pii, seller_pii, payment_info, title_docs, id_docs, signed_docs, consignor_terms, accounting_refs |
| **Transport Coordinator** | Transport queue, quotes, pickups, deliveries | ALL transport; ASSIGNED vehicles | buyer_pii (delivery contact) |
| **External Vendor** | Only explicitly assigned work orders | ASSIGNED everywhere; nothing else | none |

Notes:

- Salesperson **profit and acquisition-cost visibility is off by default** and
  is granted (if ever) by adding the `profit` / `acquisition_cost` field grants
  to the role or a per-user role in Administration.
- Multiple roles per user are supported; the union of grants applies.
- Disabled users cannot authenticate and their sessions are destroyed.

## Owner "Preview as Role"

Owners can preview the application as any role. Preview narrows the effective
permission set used for navigation, reads, and field filtering, but the real
user remains the audited actor (`actingRoles` records `owner (previewing:x)`),
and a highly visible banner shows preview state. `requireOwnerOverride` always
checks the real account, so preview can never be used to bypass or spoof.

## Enforcement points

`getSessionUser()` → `requirePermission()` / `authorize()` → scoped
where-clause → `sanitize*ForUser()` runs, in that order, on: page loads (RSC),
server actions, API route handlers, file downloads, exports, reports, search,
document generation, and notification creation. Client-side hiding is never the
control; middleware only handles the redirect-to-login convenience.

## How to add a role

1. Administration → Roles → New role (or insert a `Role` row + grants).
2. Assign `(resource, action, scope)` rows and any sensitive-field grants.
3. Assign the role to users. No code changes are required unless the role needs
   a new *resource* or *navigation item* (add to `src/lib/authz/registry.ts` and
   `src/lib/navigation.ts`).

## How to add a permission (resource or action)

1. Add the key to `RESOURCES` or `ACTIONS` in `src/lib/authz/registry.ts`.
2. Guard the new surface with `requirePermission(user, action, resource)`.
3. Add default grants to the role templates and re-seed or edit roles in
   Administration.
