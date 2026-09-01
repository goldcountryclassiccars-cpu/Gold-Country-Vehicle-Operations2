/**
 * Field-level sanitizers for vehicle/episode/arrangement data.
 * These run server-side before ANY serialization: RSC props, API responses,
 * exports, search results, notifications.
 */
import { stripFields } from "@/lib/authz/engine";
import type { SessionUser } from "@/lib/authz/types";
import type { SensitiveField } from "@/lib/authz/registry";

/** Arrangement: confidential economics protected by field grants. */
const ARRANGEMENT_PROTECTED: Partial<Record<SensitiveField, string[]>> = {
  acquisition_cost: ["purchasePrice"],
  consignor_terms: ["guaranteedConsignorNet", "commissionStructure", "reserveAmount"],
  min_price: ["minimumAcceptablePrice", "askingPriceAuthority", "priceReductionAuthority"],
  owner_notes: ["ownerNotes"],
  seller_pii: ["sellerPartyId"],
};

export function sanitizeArrangementForUser<T extends Record<string, unknown>>(
  user: SessionUser,
  arrangement: T,
): Partial<T> {
  return stripFields(user, arrangement, ARRANGEMENT_PROTECTED as Partial<Record<SensitiveField, (keyof T)[]>>);
}

/** Episode-level protected columns (profit fields appear in phase 4). */
const EPISODE_PROTECTED: Partial<Record<SensitiveField, string[]>> = {
  profit: ["forecastProfit", "finalProfit", "estimatedProfit"],
};

export function sanitizeEpisodeForUser<T extends Record<string, unknown>>(
  user: SessionUser,
  episode: T,
): Partial<T> {
  return stripFields(user, episode, EPISODE_PROTECTED as Partial<Record<SensitiveField, (keyof T)[]>>);
}

/** Party (buyer/seller PII). Callers pass which category the party is. */
export function sanitizePartyForUser<T extends Record<string, unknown>>(
  user: SessionUser,
  party: T,
  category: "buyer_pii" | "seller_pii",
): Partial<T> | { id: unknown; displayName: string } {
  const map: Partial<Record<SensitiveField, (keyof T)[]>> = {
    [category]: [
      "email",
      "phone",
      "addressLine1",
      "addressLine2",
      "city",
      "state",
      "postalCode",
      "firstName",
      "lastName",
      "notes",
    ] as (keyof T)[],
  };
  return stripFields(user, party, map);
}
