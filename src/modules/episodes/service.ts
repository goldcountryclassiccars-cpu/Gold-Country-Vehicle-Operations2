/**
 * Episode domain services. All mutations validate status values against the
 * Prisma enums, append StatusChange history rows, and write audit events.
 * Callers are responsible for authorization (requirePermission) BEFORE calling.
 */
import {
  CustodyStatus,
  DealType,
  DocStatus,
  FinancialCloseStatus,
  MarketingStatus,
  Prisma,
  ReconditioningStatus,
  SalesStatus,
} from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import type { SessionUser } from "@/lib/authz/types";
import { getScope } from "@/lib/authz/engine";
import { nextStockNumber } from "./stock-number";

export const STATUS_DIMENSIONS = {
  custody: Object.values(CustodyStatus),
  reconditioning: Object.values(ReconditioningStatus),
  marketing: Object.values(MarketingStatus),
  sales: Object.values(SalesStatus),
  document: Object.values(DocStatus),
  financial: Object.values(FinancialCloseStatus),
} as const;
export type StatusDimension = keyof typeof STATUS_DIMENSIONS;

const DIMENSION_FIELD: Record<StatusDimension, string> = {
  custody: "custodyStatus",
  reconditioning: "reconditioningStatus",
  marketing: "marketingStatus",
  sales: "salesStatus",
  document: "documentStatus",
  financial: "financialCloseStatus",
};

/** Scoped where-clause for episode list reads. */
export function episodeWhereForUser(user: SessionUser): Prisma.InventoryEpisodeWhereInput {
  const scope = getScope(user, "episodes", "view");
  if (scope === "ALL") return {};
  if (scope === "NONE") return { id: "__none__" };
  // ASSIGNED / DEPARTMENT / OWN — episodes assigned to the user.
  return { OR: [{ salespersonId: user.id }, { operationsOwnerId: user.id }] };
}

export interface CreateEpisodeInput {
  vehicleId: string;
  dealType: DealType;
  acquisitionSourceId?: string | null;
  expectedArrivalAt?: Date | null;
  askingPrice?: number | null;
  salespersonId?: string | null;
  operationsOwnerId?: string | null;
  // Arrangement (confidential) — optional at creation
  sellerPartyId?: string | null;
  purchasePrice?: number | null;
  guaranteedConsignorNet?: number | null;
  minimumAcceptablePrice?: number | null;
  ownerNotes?: string | null;
}

export async function createEpisode(user: SessionUser, input: CreateEpisodeInput) {
  const stockNumber = await nextStockNumber();
  const episode = await db.inventoryEpisode.create({
    data: {
      vehicleId: input.vehicleId,
      stockNumber,
      dealType: input.dealType,
      acquisitionSourceId: input.acquisitionSourceId ?? null,
      acceptedAt: new Date(),
      expectedArrivalAt: input.expectedArrivalAt ?? null,
      askingPrice: input.askingPrice ?? null,
      salespersonId: input.salespersonId ?? null,
      operationsOwnerId: input.operationsOwnerId ?? null,
      arrangement: {
        create: {
          sellerPartyId: input.sellerPartyId ?? null,
          purchasePrice: input.purchasePrice ?? null,
          guaranteedConsignorNet: input.guaranteedConsignorNet ?? null,
          minimumAcceptablePrice: input.minimumAcceptablePrice ?? null,
          ownerNotes: input.ownerNotes ?? null,
        },
      },
    },
  });
  await db.statusChange.create({
    data: { episodeId: episode.id, dimension: "custody", fromValue: null, toValue: "EXPECTED", changedBy: user.id },
  });
  await audit(user, {
    action: "episode.create",
    resourceType: "episode",
    resourceId: episode.id,
    newValues: { stockNumber, dealType: input.dealType, vehicleId: input.vehicleId },
  });
  return episode;
}

export class StatusError extends Error {}

/** Changes one status dimension, appending history + audit. */
export async function changeEpisodeStatus(
  user: SessionUser,
  episodeId: string,
  dimension: StatusDimension,
  toValue: string,
  reason?: string,
) {
  const allowed = STATUS_DIMENSIONS[dimension] as readonly string[];
  if (!allowed.includes(toValue)) {
    throw new StatusError(`"${toValue}" is not a valid ${dimension} status`);
  }
  const episode = await db.inventoryEpisode.findUniqueOrThrow({ where: { id: episodeId } });
  const field = DIMENSION_FIELD[dimension] as keyof typeof episode;
  const fromValue = episode[field] as string;
  if (fromValue === toValue) return episode;

  const extra: Prisma.InventoryEpisodeUpdateInput = {};
  if (dimension === "custody" && toValue === "ON_SITE" && !episode.actualArrivalAt) {
    extra.actualArrivalAt = new Date();
  }
  if (dimension === "marketing" && toValue === "LIVE" && !episode.firstListedAt) {
    extra.firstListedAt = new Date();
  }
  if (dimension === "financial" && toValue === "FINANCIALLY_CLOSED") {
    extra.closedAt = new Date();
    extra.active = false;
  }

  const updated = await db.inventoryEpisode.update({
    where: { id: episodeId },
    data: { [DIMENSION_FIELD[dimension]]: toValue, ...extra },
  });
  await db.statusChange.create({
    data: { episodeId, dimension, fromValue, toValue, reason: reason || null, changedBy: user.id },
  });
  await audit(user, {
    action: `episode.status.${dimension}`,
    resourceType: "episode",
    resourceId: episodeId,
    previousValues: { [dimension]: fromValue },
    newValues: { [dimension]: toValue },
    reason,
  });
  return updated;
}

/** Updates the asking price, appending price history + audit. */
export async function setAskingPrice(user: SessionUser, episodeId: string, price: number, reason?: string) {
  const episode = await db.inventoryEpisode.findUniqueOrThrow({ where: { id: episodeId } });
  const from = episode.askingPrice?.toString() ?? null;
  const updated = await db.inventoryEpisode.update({
    where: { id: episodeId },
    data: { askingPrice: price },
  });
  await db.statusChange.create({
    data: { episodeId, dimension: "asking_price", fromValue: from, toValue: String(price), reason: reason || null, changedBy: user.id },
  });
  await audit(user, {
    action: "episode.price.update",
    resourceType: "episode",
    resourceId: episodeId,
    previousValues: { askingPrice: from },
    newValues: { askingPrice: price },
    reason,
  });
  return updated;
}
