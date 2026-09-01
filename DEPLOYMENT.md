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
2. **Project Settings → Database → Connection string → URI.** You need two
   forms of it:
   - **Pooled** (host contains `pooler`, port `6543`) → this becomes
     `DATABASE_URL`. Append `?pgbouncer=true&connection_limit=1`.
   - **Direct** (port `5432`) → this becomes `DIRECT_URL`.

   Both are required. Serverless functions open far more connections than
   Postgres tolerates, so normal queries go through the pooler; migrations need
   a direct connection because the pooler cannot run them.
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

### Environment variables

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Supabase **pooled** URI + `?pgbouncer=true&connection_limit=1` |
| `DIRECT_URL` | Supabase **direct** URI (port 5432) |
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
DIRECT_URL="<supabase direct uri>" DATABASE_URL="<supabase direct uri>" npm run db:seed
```

Use the **direct** URI for both, not the pooled one. This creates 8 departments,
10 roles, 12 demo users, 4 vehicles and their supporting records.

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
