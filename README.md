# GCCC Ops — Gold Country Classic Cars Vehicle Operations Platform

The operational source of truth for every vehicle: acquisition/consignment →
intake → reconditioning → media → listing → sale → documents → transport →
settlement → financial close → permanent archive.

> Build in progress. This README is expanded as phases complete; see
> `BUILD_STATUS.md` for accurate current status.

## Prerequisites

- Node.js 20+ (22 recommended)
- Docker (for PostgreSQL)

## Quick start

```bash
cp .env.example .env          # then set SESSION_SECRET (openssl rand -base64 32)
npm install
npm run db:up                 # starts PostgreSQL 16 via Docker Compose
npm run db:migrate            # applies Prisma migrations
npm run db:seed               # seeds roles, departments, demo users, demo vehicles
npm run dev                   # http://localhost:3000
```

## Demo users (development only — never production)

All demo accounts share the password `GcccDemo!2026`.

| Email | Role |
|-------|------|
| jade@demo.gccc | Owner |
| sergio@demo.gccc | Owner |
| ops@demo.gccc | Operations Manager |
| mechanic@demo.gccc | Mechanic |
| detailer@demo.gccc | Detailer |
| body@demo.gccc | Body & Paint |
| media@demo.gccc | Media / Marketing |
| sales@demo.gccc | Salesperson |
| finance@demo.gccc | Finance / Title |
| transport@demo.gccc | Transport Coordinator |
| vendor@demo.gccc | External Vendor |
| disabled@demo.gccc | (disabled account, for testing) |

## Commands

```bash
npm run dev          # development server
npm run build        # production build
npm run lint         # ESLint
npm run typecheck    # TypeScript strict
npm test             # Vitest unit + integration tests
npm run test:e2e     # Playwright end-to-end tests
npm run db:studio    # Prisma Studio
npm run db:reset     # drop, re-migrate, re-seed
```

## Documentation

- `PROJECT_NOTES.md` — dealership context
- `ARCHITECTURE.md` — technical and data-model decisions
- `PERMISSIONS.md` — roles, record scopes, sensitive fields, enforcement
- `SALES_DOCUMENT_SETUP.md` — what the dealership must provide before legal
  document automation is enabled
- `BUILD_STATUS.md` — current, accurate build status
