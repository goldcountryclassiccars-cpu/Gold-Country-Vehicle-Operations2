# Inventory import

Administration → **Import inventory** (`/admin/import`) loads many vehicles at
once from a spreadsheet. It exists because typing twenty classic cars into the
New Vehicle form one at a time is the kind of chore that decides whether a
system gets adopted or abandoned.

## How it is put together

| File | Role |
| --- | --- |
| `src/modules/import/csv.ts` | RFC 4180 reader/writer. No dependency — see the file header for why. |
| `src/modules/import/columns.ts` | The column contract: template header, on-screen help, and every loose-value → enum coercion. |
| `src/modules/import/service.ts` | `planImport` (reads only) and `commitImport` (writes). |
| `src/modules/import/actions.ts` | Server actions; permission checks live here. |
| `src/app/(app)/admin/import/` | The two-step screen and the template download route. |

## The two rules worth keeping

**The preview is the plan.** `planImport` writes nothing and returns exactly
what a commit would do. `commitImportAction` re-runs `planImport` on the same
file text rather than trusting a plan that has been round-tripped through the
browser, so there is no path by which the import writes something the operator
was not shown.

**Re-uploading is safe.** A row whose identifier already exists — compared with
case and punctuation stripped, so `AN5L-4702` and `an5l 4702` are one car — is
reported and skipped. A row with *no* identifier that matches an active episode
by year/make/model is held back as a *possible* duplicate until the operator
ticks "this is a different car". This is why the commit does not need to be
atomic across rows: if row 15 fails, the operator fixes that line and uploads
the same file again, and the first fourteen cars are not entered twice.

## Permissions

Requires `vehicles:create`, `episodes:create` **and** `admin:manage_config` —
in the three-role model, Admin only. The confidential columns (`purchase_price`,
`minimum_price`, `owner_notes`) are governed separately by the same field grants
the rest of the app uses: a user without the grant gets a warning in the preview
and the value is dropped rather than silently written.

## Things that are deliberate, not oversights

- **`deal_type` is required with no default.** Consignment versus dealer-owned
  drives profitability and consignor settlements. A wrong guess is worse than a
  blocked row.
- **`mileage_status` defaults to Unknown and warns.** It is an odometer
  disclosure. The importer will not infer it from the year.
- **`acquired_date` back-dates `acceptedAt`.** Without it, back-filling existing
  inventory would restart every car's aging clock at zero and the 90+ day report
  in `/reports` would read as empty.
- **Statuses go through `changeEpisodeStatus`.** An imported car gets the same
  `StatusChange` history and audit events as one typed in by hand.
- **Every import writes one `inventory.import` audit event** naming the stock
  numbers it created.

## Limits

500 rows and 1 MB per file; both are constants at the top of `service.ts`.
Photos are not part of the import — upload those per vehicle in Media.
