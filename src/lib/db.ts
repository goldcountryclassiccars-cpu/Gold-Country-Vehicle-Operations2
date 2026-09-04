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

export const db = globalForPrisma.prisma ?? new PrismaClient({ log });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
