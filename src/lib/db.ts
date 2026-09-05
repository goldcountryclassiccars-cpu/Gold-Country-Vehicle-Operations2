import { PrismaClient } from "@prisma/client";

// Prisma client singleton — avoids exhausting connections during dev hot reload.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Set PRISMA_LOG=1 to log every SQL statement.
 *
 * Worth keeping: the number of queries a page issues is the number of network
 * round trips it pays for, and that is the thing that actually determines how
 * fast this app feels in production. Counting them is how the eight-query
 * session lookup was found. To profile a page:
 *
 *   PRISMA_LOG=1 npm run start
 *   # then load the page and count the `prisma:query` lines it produced
 */
const log: ("query" | "warn" | "error")[] = process.env.PRISMA_LOG
  ? ["query", "warn", "error"]
  : process.env.NODE_ENV === "development"
    ? ["warn", "error"]
    : ["error"];

/**
 * How many connections one serverless instance may hold against the pooler.
 *
 * This is an application property, not a per-environment secret. It has to be
 * at least as large as the widest `Promise.all` the app issues, or those
 * queries queue against each other and the parallelism is a lie — the
 * dashboard page fans out five ways, so a limit of 1 makes it five sequential
 * round trips. Supabase's transaction pooler multiplexes, so a small number per
 * instance is correct; large numbers exhaust the pooler under concurrency.
 *
 * Five is the smallest value that covers the current fan-out with headroom.
 */
const DEFAULT_CONNECTION_LIMIT = 5;

/**
 * Guarantees the connection string carries a workable `connection_limit`.
 *
 * Previously this lived only in the hosting dashboard, which meant the app's
 * performance depended on a setting nobody could see from the code, that no
 * review would catch, and that silently reverts if the variable is ever
 * recreated. Encoding it here makes it reviewable and impossible to lose.
 *
 * A value already present is raised but never lowered, so an operator who
 * deliberately sets a *higher* limit keeps it; `PRISMA_CONNECTION_LIMIT`
 * overrides the floor entirely for the case where the pooler needs something
 * different. Anything unparseable is passed through untouched — a malformed
 * URL is Prisma's error to report, with its own better message, not ours to
 * swallow at import time.
 */
export function withConnectionLimit(rawUrl: string | undefined, floor = DEFAULT_CONNECTION_LIMIT): string | undefined {
  if (!rawUrl) return rawUrl;
  try {
    const url = new URL(rawUrl);
    const current = Number(url.searchParams.get("connection_limit"));
    if (Number.isFinite(current) && current >= floor) return rawUrl;
    url.searchParams.set("connection_limit", String(floor));
    return url.toString();
  } catch {
    return rawUrl;
  }
}

const envFloor = Number(process.env.PRISMA_CONNECTION_LIMIT);
const datasourceUrl = withConnectionLimit(
  process.env.DATABASE_URL,
  Number.isFinite(envFloor) && envFloor > 0 ? envFloor : DEFAULT_CONNECTION_LIMIT,
);

export const db =
  globalForPrisma.prisma ??
  (datasourceUrl ? new PrismaClient({ log, datasourceUrl }) : new PrismaClient({ log }));

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
