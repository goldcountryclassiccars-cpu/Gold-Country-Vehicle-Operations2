/**
 * Minimal RFC 4180 CSV reader and writer.
 *
 * Deliberately not a dependency. The app reads one small, well-specified file
 * produced by a spreadsheet, and a parser short enough to read in one sitting
 * is easier to trust than a transitive dependency tree. It handles what real
 * spreadsheets actually emit: quoted fields, embedded commas and newlines,
 * doubled quotes, CRLF line endings, and the UTF-8 BOM that Excel writes.
 */

/** Parse CSV text into rows of raw string cells. Blank trailing lines are dropped. */
export function parseCsv(text: string): string[][] {
  // Excel prefixes exports with a BOM; it would otherwise become part of the
  // first header name and every column lookup would miss.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let sawAnyChar = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      sawAnyChar = true;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      sawAnyChar = true;
      continue;
    }
    if (ch === "\r") continue; // CRLF — the \n does the work
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      sawAnyChar = false;
      continue;
    }
    field += ch;
    sawAnyChar = true;
  }

  if (sawAnyChar || field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop rows that are entirely empty (trailing newlines, blank separator rows).
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Quote a single cell only when it needs it. */
function quote(cell: string): string {
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

/** Serialize rows to CSV text with CRLF endings (what spreadsheets expect). */
export function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map(quote).join(",")).join("\r\n") + "\r\n";
}

/**
 * Turn parsed rows into header-keyed records.
 *
 * Header matching is forgiving on purpose — people rename columns while
 * editing. "Asking Price", "asking price" and "asking_price" all resolve to
 * `asking_price`, so a round trip through Excel does not break the import.
 */
export function normalizeHeader(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

export interface CsvTable {
  headers: string[];
  /** One record per data row, keyed by normalized header. */
  records: Record<string, string>[];
  /** Source line number (1-based, counting the header) for each record. */
  lineNumbers: number[];
}

export function toTable(rows: string[][]): CsvTable {
  const headerRow = rows[0];
  if (!headerRow) return { headers: [], records: [], lineNumbers: [] };
  const headers = headerRow.map(normalizeHeader);
  const records: Record<string, string>[] = [];
  const lineNumbers: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i] ?? [];
    const rec: Record<string, string> = {};
    headers.forEach((h, idx) => {
      if (h) rec[h] = (cells[idx] ?? "").trim();
    });
    records.push(rec);
    lineNumbers.push(i + 1);
  }
  return { headers, records, lineNumbers };
}
