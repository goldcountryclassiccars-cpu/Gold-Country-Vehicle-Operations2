/**
 * CSV reader tests.
 *
 * These are written against what real spreadsheets emit rather than against a
 * tidy idea of CSV: descriptions in this business routinely contain commas,
 * inch marks ("15\" wire wheels") and line breaks, and Excel stamps a BOM on
 * every export. Each of those has its own case here because each of them would
 * silently corrupt a vehicle record rather than fail loudly.
 */
import { describe, expect, it } from "vitest";
import { normalizeHeader, parseCsv, toCsv, toTable } from "@/modules/import/csv";

describe("parseCsv", () => {
  it("reads a plain file", () => {
    expect(parseCsv("a,b,c\n1,2,3\n")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("keeps commas inside quoted fields", () => {
    const rows = parseCsv('make,description\nFord,"Black, red interior, sharp"\n');
    expect(rows[1]!).toEqual(["Ford", "Black, red interior, sharp"]);
  });

  it("unescapes doubled quotes — inch marks survive", () => {
    const rows = parseCsv('model,description\nTR4,"Fitted with 15"" wire wheels"\n');
    expect(rows[1]![1]).toBe('Fitted with 15" wire wheels');
  });

  it("keeps newlines inside quoted fields", () => {
    const rows = parseCsv('model,description\nDart,"Line one\nLine two"\n');
    expect(rows).toHaveLength(2);
    expect(rows[1]![1]).toBe("Line one\nLine two");
  });

  it("handles CRLF line endings", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("strips the UTF-8 BOM Excel writes", () => {
    const rows = parseCsv("﻿make,model\nMG,TF\n");
    expect(rows[0]![0]).toBe("make");
  });

  it("drops blank lines rather than emitting empty vehicles", () => {
    expect(parseCsv("a,b\n1,2\n\n\n")).toHaveLength(2);
  });

  it("reads a final row with no trailing newline", () => {
    expect(parseCsv("a,b\n1,2")).toHaveLength(2);
  });

  it("preserves empty cells in the middle of a row", () => {
    expect(parseCsv("a,b,c\n1,,3\n")[1]!).toEqual(["1", "", "3"]);
  });
});

describe("toCsv", () => {
  it("round-trips values that need quoting", () => {
    const rows = [
      ["make", "description"],
      ["Triumph", 'Has a comma, a "quote" and\na newline'],
    ];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });

  it("does not quote values that do not need it", () => {
    expect(toCsv([["a", "b"]])).toBe("a,b\r\n");
  });
});

describe("normalizeHeader", () => {
  it("accepts the ways a person might retype a column name", () => {
    for (const variant of ["asking_price", "Asking Price", " ASKING-PRICE ", "Asking price:"]) {
      expect(normalizeHeader(variant)).toBe("asking_price");
    }
  });
});

describe("toTable", () => {
  it("keys records by normalized header and trims cells", () => {
    const table = toTable(parseCsv("Make, Asking Price \nFord, $49,900 \n".replace("$49,900", '"$49,900"')));
    expect(table.records[0]!).toEqual({ make: "Ford", asking_price: "$49,900" });
  });

  it("reports the source line number so errors point at the right row", () => {
    const table = toTable(parseCsv("make\nFord\nMG\n"));
    expect(table.lineNumbers).toEqual([2, 3]);
  });

  it("returns nothing for an empty file", () => {
    expect(toTable(parseCsv(""))).toEqual({ headers: [], records: [], lineNumbers: [] });
  });
});
