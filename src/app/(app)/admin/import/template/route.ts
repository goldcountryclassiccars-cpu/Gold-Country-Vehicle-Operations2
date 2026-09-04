import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/authz/engine";
import { toCsv } from "@/modules/import/csv";
import { TEMPLATE_EXAMPLE, TEMPLATE_HEADER } from "@/modules/import/columns";

/**
 * The blank import template. Generated from the same COLUMNS list the parser
 * uses, so a downloaded template can never be out of step with what the
 * importer accepts.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!hasPermission(user, "admin", "manage_config")) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const csv = toCsv([TEMPLATE_HEADER, TEMPLATE_EXAMPLE]);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="gccc-inventory-template.csv"',
      "Cache-Control": "no-store",
    },
  });
}
