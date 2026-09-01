import { db } from "@/lib/db";

/**
 * Stock numbers are configurable via the "stock_number" AppSetting:
 * { prefix: "GC", nextNumber: 1001, padding: 4 } → "GC-1001".
 * Generation is transactional to avoid duplicates.
 */
const DEFAULT = { prefix: "GC", nextNumber: 1001, padding: 4 };

export async function nextStockNumber(): Promise<string> {
  return db.$transaction(async (tx) => {
    const setting = await tx.appSetting.findUnique({ where: { key: "stock_number" } });
    const cfg = { ...DEFAULT, ...((setting?.value as object) ?? {}) } as typeof DEFAULT;
    const num = cfg.nextNumber;
    await tx.appSetting.upsert({
      where: { key: "stock_number" },
      update: { value: { ...cfg, nextNumber: num + 1 } },
      create: { key: "stock_number", value: { ...cfg, nextNumber: num + 1 } },
    });
    return `${cfg.prefix}-${String(num).padStart(cfg.padding, "0")}`;
  });
}
