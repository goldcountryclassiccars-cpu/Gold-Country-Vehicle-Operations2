import { timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";
import { config } from "@/lib/config";

/** Bearer-token check for the listing-application integration API. */
export function integrationAuthorized(req: NextRequest): boolean {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const expected = config().LISTING_API_KEY;
  if (!token || token.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  } catch {
    return false;
  }
}
