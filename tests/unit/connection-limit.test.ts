/**
 * The connection limit used to live only in the hosting dashboard, where it sat
 * at 1 and quietly serialised every parallel query in the app. These tests pin
 * the behaviour now that it is code: it must be raised when too low, left alone
 * when already generous, and it must never mangle a connection string.
 */
import { describe, expect, it } from "vitest";
import { withConnectionLimit } from "@/lib/db";

const BASE = "postgresql://user:pw@aws-0-us-west-2.pooler.supabase.com:6543/postgres";

function limitOf(url: string | undefined): string | null {
  return new URL(url!).searchParams.get("connection_limit");
}

describe("withConnectionLimit", () => {
  it("raises the limit that was throttling production", () => {
    const out = withConnectionLimit(`${BASE}?pgbouncer=true&connection_limit=1`);
    expect(limitOf(out)).toBe("5");
  });

  it("adds one when the URL has none", () => {
    expect(limitOf(withConnectionLimit(BASE))).toBe("5");
  });

  it("leaves a deliberately higher limit alone", () => {
    const url = `${BASE}?connection_limit=20`;
    expect(withConnectionLimit(url)).toBe(url);
  });

  it("respects an explicit floor", () => {
    expect(limitOf(withConnectionLimit(`${BASE}?connection_limit=2`, 10))).toBe("10");
  });

  it("keeps every other parameter, including pgbouncer", () => {
    const out = new URL(withConnectionLimit(`${BASE}?pgbouncer=true&sslmode=require&connection_limit=1`)!);
    expect(out.searchParams.get("pgbouncer")).toBe("true");
    expect(out.searchParams.get("sslmode")).toBe("require");
  });

  it("preserves host, port, database and credentials untouched", () => {
    const out = new URL(withConnectionLimit(`${BASE}?connection_limit=1`)!);
    expect(out.hostname).toBe("aws-0-us-west-2.pooler.supabase.com");
    expect(out.port).toBe("6543");
    expect(out.pathname).toBe("/postgres");
    expect(out.username).toBe("user");
    expect(out.password).toBe("pw");
  });

  it("passes through anything it cannot parse rather than throwing at import time", () => {
    expect(withConnectionLimit("not a url")).toBe("not a url");
    expect(withConnectionLimit(undefined)).toBeUndefined();
    expect(withConnectionLimit("")).toBe("");
  });
});
