/**
 * `partitionColumns` decides what a phone card shows. Every failure mode is
 * silent — a dropped column still renders a plausible card — so the invariant
 * that every column lands in exactly one bucket is asserted directly.
 */
import { describe, expect, it } from "vitest";
import { partitionColumns, type Column } from "@/components/data-table";

interface Row {
  name: string;
  price: number;
}

const col = (key: string, phone?: Column<Row>["phone"]): Column<Row> => ({
  key,
  header: key,
  cell: (r) => `${r.name}:${key}`,
  phone,
});

/** Every input column must come back exactly once, somewhere. */
function allKeys(p: ReturnType<typeof partitionColumns<Row>>): string[] {
  return [
    ...(p.title ? [p.title.key] : []),
    ...p.meta.map((c) => c.key),
    ...p.lines.map((c) => c.key),
    ...p.hidden.map((c) => c.key),
  ].sort();
}

describe("partitionColumns", () => {
  it("defaults the first column to the card heading and the rest to lines", () => {
    const p = partitionColumns([col("vehicle"), col("vin"), col("stock")]);
    expect(p.title?.key).toBe("vehicle");
    expect(p.lines.map((c) => c.key)).toEqual(["vin", "stock"]);
    expect(p.meta).toEqual([]);
    expect(p.hidden).toEqual([]);
  });

  it("honours explicit roles over the positional defaults", () => {
    const p = partitionColumns([col("stage", "meta"), col("vehicle", "title"), col("asking", "line")]);
    expect(p.title?.key).toBe("vehicle");
    expect(p.meta.map((c) => c.key)).toEqual(["stage"]);
    expect(p.lines.map((c) => c.key)).toEqual(["asking"]);
  });

  it("keeps desktop-only columns out of the card but does not lose them", () => {
    const p = partitionColumns([col("vehicle"), col("notes", "desktop-only")]);
    expect(p.lines).toEqual([]);
    expect(p.hidden.map((c) => c.key)).toEqual(["notes"]);
    expect(allKeys(p)).toEqual(["notes", "vehicle"]);
  });

  it("demotes a second declared title to a line rather than replacing the first", () => {
    const p = partitionColumns([col("vehicle", "title"), col("stock", "title"), col("asking")]);
    expect(p.title?.key).toBe("vehicle");
    // The value still appears on the card — just not as the heading.
    expect(p.lines.map((c) => c.key)).toEqual(["stock", "asking"]);
  });

  it("places every column in exactly one bucket, with no duplicates", () => {
    const columns = [
      col("a"),
      col("b", "meta"),
      col("c", "line"),
      col("d", "desktop-only"),
      col("e", "title"),
      col("f"),
    ];
    const p = partitionColumns(columns);
    expect(allKeys(p)).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(allKeys(p)).toHaveLength(columns.length);
  });

  it("does not invent a heading when the only column is desktop-only", () => {
    const p = partitionColumns([col("internal", "desktop-only")]);
    expect(p.title).toBeNull();
    expect(p.hidden.map((c) => c.key)).toEqual(["internal"]);
  });

  it("returns empty buckets for no columns", () => {
    const p = partitionColumns<Row>([]);
    expect(p.title).toBeNull();
    expect(p.meta).toEqual([]);
    expect(p.lines).toEqual([]);
    expect(p.hidden).toEqual([]);
  });
});
