/**
 * Brings the database's role grants up to date with the templates in
 * src/lib/authz/registry.ts — additively.
 *
 * Needed because roles are data: when a code change introduces a NEW resource
 * (the calendar, say), production's role rows know nothing about it, so
 * navigation hides it from everyone but the fullAccess admin rows would also
 * be missing. This script inserts the template's grants for any
 * (role, resource, action) pair the database lacks, and updates a pair whose
 * scope differs from the template. It NEVER deletes: a grant an Admin added by
 * hand in Administration is somebody's deliberate decision.
 *
 * Same shape as the other seeds: idempotent, dry-run by default, --apply to
 * write. Runs in vercel-build, so shipping a new resource is one deploy.
 */
import { PrismaClient, type PermissionScope } from "@prisma/client";
import { ROLE_TEMPLATES } from "../src/lib/authz/registry";

const db = new PrismaClient();
const apply = process.argv.includes("--apply");

async function main() {
  let created = 0;
  let updated = 0;
  for (const tpl of ROLE_TEMPLATES) {
    const role = await db.role.findUnique({ where: { key: tpl.key }, include: { permissions: true } });
    if (!role) {
      console.log(`role ${tpl.key}: not in database, skipping (seed users/roles first)`);
      continue;
    }
    const existing = new Map(role.permissions.map((p) => [`${p.resource}:${p.action}`, p]));
    for (const [resource, grant] of Object.entries(tpl.grants)) {
      for (const [action, scope] of Object.entries(grant as Record<string, PermissionScope>)) {
        const key = `${resource}:${action}`;
        const row = existing.get(key);
        if (!row) {
          created += 1;
          if (apply) {
            await db.rolePermission.create({ data: { roleId: role.id, resource, action, scope } });
          } else {
            console.log(`would add    ${tpl.key} ${key} = ${scope}`);
          }
        } else if (row.scope !== scope && tpl.key === "admin") {
          // Only the admin role is locked to its template; other roles may have
          // been deliberately adjusted in Administration.
          updated += 1;
          if (apply) {
            await db.rolePermission.update({ where: { id: row.id }, data: { scope } });
          } else {
            console.log(`would update ${tpl.key} ${key}: ${row.scope} -> ${scope}`);
          }
        }
      }
    }
  }
  console.log(`${apply ? "Applied" : "Dry run"}: ${created} grant(s) added, ${updated} updated.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
