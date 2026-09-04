# Deploying GCCC Ops

This describes the first production-shaped deployment: **Vercel** for the app,
**Supabase** for both the Postgres database and the private file storage.

Two accounts, both free tier, both sufficient for a dealership of this size.

Why this pairing: Vercel runs Next.js natively, and Supabase gives Postgres and
an S3-compatible object store behind a single login — so photos, scans and
generated PDFs have somewhere permanent to live without a third service.

---

## The one thing that does not survive a naive deploy

Serverless hosts give each request a fresh, disposable filesystem. Anything the
app writes to disk is gone by the next request, and may not even be writable in
the first place. That means the development storage adapter
(`STORAGE_ADAPTER="local"`, writing under `./storage`) **cannot** be used in
production: every uploaded photo and every generated sale document would appear
to save and then vanish.

Production therefore runs `STORAGE_ADAPTER="s3"` against Supabase Storage. The
bucket stays **private** — nothing is served straight from the object store.
Reads still go through `/api/files/[id]`, which checks the caller's permission
and, for sensitive files, the matching field grant before returning bytes. That
is deliberate: a title scan or a signed bill of sale must not be reachable by
anyone who guesses a URL.

---

## 1. Supabase — database and storage

1. Create a project at supabase.com. Choose a region near the dealership.
   Save the database password it generates; it appears once.
2. **Connect** (top of the project dashboard). Supabase offers three connection
   strings; take these two, and note that neither of them is the one labelled
   "Direct connection":
   - **Transaction pooler**, port `6543` → `DATABASE_URL`. Append
     `?pgbouncer=true&connection_limit=5`.

     `connection_limit=1` is the usual serverless advice, but it serialises
     every query a single request makes — including the ones the app
     deliberately issues in parallel with `Promise.all`. A transaction pooler
     hands connections back per statement, so a small pool per function
     instance is safe and lets those parallel queries actually overlap.
   - **Session pooler**, port `5432` → `DIRECT_URL`.

   Two are needed because serverless functions open far more connections than
   Postgres tolerates, so ordinary queries go through the transaction pooler,
   while migrations need a session-mode connection (the transaction pooler does
   not support the prepared statements Prisma's migration engine issues).

   **Do not use "Direct connection" here even though the name matches the
   variable.** Supabase serves it over IPv6 only, unless the paid IPv4 add-on is
   enabled, and Vercel's build and function environments are IPv4. The failure
   looks like a hostname that will not resolve during `prisma migrate deploy` —
   easy to misread as a wrong password. The session pooler is IPv4 on every
   tier and is the supported substitute.
3. **Storage → New bucket.** Name it `gccc-media`. Leave **Public** switched
   **off**.
4. **Project Settings → Storage → S3 access keys → New access key.** Copy the
   access key ID and secret. The S3 endpoint is
   `https://<project-ref>.supabase.co/storage/v1/s3`.

## 2. Vercel — the app

1. Sign in at vercel.com with GitHub and import
   `goldcountryclassiccars-cpu/Gold-Country-Vehicle-Operations2`. When asked
   whether the work is personal or commercial, answer **commercial** — see
   "Cost, honestly" below for why this is not optional.
2. Framework preset: **Next.js**. Leave the build settings alone — the repo
   defines a `vercel-build` script that applies database migrations before
   building, so schema changes deploy automatically.
3. Add the environment variables below, then deploy.
4. **Check the function region matches the database region.** `vercel.json`
   pins functions to `pdx1` (Portland), which sits alongside a Supabase
   project in `us-west-2`. If the Supabase project is somewhere else, change
   `vercel.json` to match it.

   This is not a micro-optimisation. Vercel's default region is `iad1`
   (Washington DC); with the database in Oregon, every single query became a
   ~70ms transcontinental round trip, and a page that issues a dozen
   sequential queries paid that a dozen times. It was the largest single
   cause of the app feeling slow. Confirm it after deploying — the
   `x-vercel-id` response header names the region that served the request:

   ```
   curl -sD - -o /dev/null https://<your-app>.vercel.app/api/health | grep x-vercel-id
   ```

### Environment variables

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Supabase **transaction pooler** URI (6543) + `?pgbouncer=true&connection_limit=5` |
| `DIRECT_URL` | Supabase **session pooler** URI (5432) — not "Direct connection" |
| `SESSION_SECRET` | 32+ random bytes — `openssl rand -base64 32` |
| `APP_URL` | `https://<your-project>.vercel.app` |
| `STORAGE_ADAPTER` | `s3` |
| `S3_ENDPOINT` | `https://<project-ref>.supabase.co/storage/v1/s3` |
| `S3_BUCKET` | `gccc-media` |
| `S3_ACCESS_KEY_ID` | from Supabase S3 access keys |
| `S3_SECRET_ACCESS_KEY` | from Supabase S3 access keys |
| `S3_REGION` | your Supabase project region, e.g. `us-west-1` |
| `S3_FORCE_PATH_STYLE` | `true` |
| `EMAIL_ADAPTER` | `log` until real SMTP is configured |
| `LISTING_API_KEY` | a long random string — `openssl rand -hex 32` |
| `SESSION_TTL_HOURS` | `12` |

`SESSION_SECRET` and `LISTING_API_KEY` must be newly generated. Never reuse the
placeholder values from `.env.example`; they are published in a public repo.

The app validates this whole set at boot (`src/lib/config.ts`). A missing or
malformed value fails the deployment with a message naming the variable, rather
than breaking later at the moment someone tries to upload a photo.

## 3. Seed the demo data — once

Migrations run automatically on deploy; seeding does not, because it must never
run twice against real inventory. From a machine with Node installed and the
repository checked out:

```
DATABASE_URL="<session pooler uri>" DIRECT_URL="<session pooler uri>" npm run db:seed
```

Use the **session pooler** URI for both — the seed script writes in long
transactions, which the transaction pooler will not hold. This creates 8
departments, 10 roles, 12 demo users, 4 vehicles and their supporting records.

## 4. First login, and the thing to do immediately

Sign in as `jade@demo.gccc` with the demo password in `prisma/seed.ts`.

**That password is committed to a public repository.** Before anyone else is
invited, and before any real vehicle is entered:

1. **Administration → Users** — create a real owner account with a real email
   and a password of your own.
2. Sign in as that account, and **disable every `@demo.gccc` user.** Disabling
   destroys their active sessions.

Until that is done, treat the deployment as a demo, not as a system of record.

---

## What is still demo-grade after this deploy

Deploying does not make these real. They are known gaps, not bugs:

- **Sale documents** are watermarked `DEMO` and the e-signature step is a mock.
  Real closing paperwork needs the approved templates listed in
  `SALES_DOCUMENT_SETUP.md`.
- **Email notifications** are written to the log, not sent. Switching
  `EMAIL_ADAPTER` to `smtp` requires SMTP credentials and a verified sender.
- **The listing feed** (`/api/integration/...`) is a working authenticated
  outbox, but nothing consumes it yet — no marketplace is connected.
- **Rate limiting** on the login endpoint is in-process, which on serverless
  means per-instance. Shared rate limiting needs Redis.

## Cost, honestly

**Vercel requires a paid plan here.** Its Hobby tier is restricted to
non-commercial personal use, and it defines commercial usage as any deployment
"used for the purpose of financial gain of anyone involved in any part of the
production of the project." An internal system that tracks inventory, deal
margins and consignor settlements for a working dealership is commercial under
that definition, even though nothing is sold through it and it is never public.
When Vercel asks during signup, answer **commercial**. That means Pro, at $20
per month per developer seat — viewer seats are free, so one seat is enough.

Supabase carries no equivalent restriction; its free plan may be used
commercially. What limits it is capacity, not licensing:

- **500MB database.** Ample. These are text records; it will not be the binding
  constraint.
- **1GB file storage.** This *is* the binding constraint. Vehicle photography
  at full resolution runs 3–8MB per image, so a few hundred photos exhausts it.
- **Project pausing.** A free project pauses after a week with no activity and
  resumes on the next request after a delay. Daily use prevents this.

Supabase Pro is around $25/month and lifts all three. A sensible sequence is to
start free, and move to Pro when photo storage — not anything else — forces it.
