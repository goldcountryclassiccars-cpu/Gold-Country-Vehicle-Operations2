/**
 * One-time data migration: ten roles -> three (Admin / Front Desk / Shop).
 *
 * Role definitions live in code but role *assignments* live in the database, so
 * shipping the new registry alone would leave every existing account holding a
 * role key the app no longer knows about. The visible symptom is an owner who
 * quietly stops being an owner, because isOwner now looks for "admin".
 *
 * Idempotent: safe to run more than once, and safe to run before or after the
 * new code is deployed.
 *
 *   DATABASE_URL="<session pooler uri>" npx tsx prisma/migrate-roles.ts
 *
 * Pass --apply to write. Without it the script reports what it would do and
 * changes nothing.
 */
import { PrismaClient, type PermissionScope } from "@prisma/client";
import { ROLE_TEMPLATES } from "../src/lib/authz/registry";

const db = new PrismaClient();

/** Old role key -> new role key. */
const MAPPING: Record<string, string> = {
  owner: "admin",
  ops_manager: "front_desk",
  sales: "front_desk",
  finance: "front_desk",
  transport: "front_desk",
  mechanic: "shop",
  detailer: "shop",
  body: "shop",
  media: "shop",
  vendor: "shop",
};

async function main() {
  const apply = process.argv.includes("--apply");
  const label = apply ? "APPLYING" : "DRY RUN (pass --apply to write)";
  console.log(`\n=== Role migration — ${label} ===\n`);

  // 1. Make sure the three new roles exist, with their permissions and field grants.
  for (const tpl of ROLE_TEMPLATES) {
    const existing = await db.role.findUnique({ where: { key: tpl.key } });
    if (existing) {
      console.log(`role "${tpl.key}" already present`);
      continue;
    }
    console.log(`role "${tpl.key}" will be created`);
    if (!apply) continue;
    const role = await db.role.create({
      data: { key: tpl.key, name: tpl.name, description: tpl.description, isSystem: true },
    });
    for (const [resource, grant] of Object.entries(tpl.grants)) {
      for (const [action, scope] of Object.entries(grant ?? {})) {
        await db.rolePermission.create({
          data: { roleId: role.id, resource, action, scope: scope as PermissionScope },
        });
      }
    }
    for (const fieldKey of tpl.fieldGrants) {
      await db.roleFieldGrant.create({ data: { roleId: role.id, fieldKey } });
    }
  }

  // 2. Move every user off a retired role and onto its replacement.
  const newRoleIdByKey = new Map<string, string>();
  for (const tpl of ROLE_TEMPLATES) {
    const r = await db.role.findUnique({ where: { key: tpl.key } });
    if (r) newRoleIdByKey.set(tpl.key, r.id);
  }

  let moved = 0;
  for (const [oldKey, newKey] of Object.entries(MAPPING)) {
    const oldRole = await db.role.findUnique({ where: { key: oldKey } });
    if (!oldRole) continue;
    const links = await db.userRole.findMany({
      where: { roleId: oldRole.id },
      include: { user: { select: { id: true, email: true } } },
    });
    if (links.length === 0) continue;

    const newRoleId = newRoleIdByKey.get(newKey);
    for (const link of links) {
      console.log(`  ${link.user.email}: ${oldKey} -> ${newKey}`);
      moved++;
      if (!apply || !newRoleId) continue;
      const already = await db.userRole.findFirst({
        where: { userId: link.userId, roleId: newRoleId },
      });
      if (!already) {
        await db.userRole.create({ data: { userId: link.userId, roleId: newRoleId } });
      }
      await db.userRole.delete({
        where: { userId_roleId: { userId: link.userId, roleId: oldRole.id } },
      });
    }
  }
  console.log(`\n${moved} role assignment(s) ${apply ? "moved" : "would move"}`);

  // 3. Remove the retired roles, but only once nothing points at them.
  for (const oldKey of Object.keys(MAPPING)) {
    const oldRole = await db.role.findUnique({ where: { key: oldKey } });
    if (!oldRole) continue;
    const remaining = await db.userRole.count({ where: { roleId: oldRole.id } });
    if (remaining > 0) {
      console.log(`keeping "${oldKey}" — ${remaining} assignment(s) still attached`);
      continue;
    }
    console.log(`retired role "${oldKey}" ${apply ? "deleted" : "would be deleted"}`);
    if (!apply) continue;
    await db.rolePermission.deleteMany({ where: { roleId: oldRole.id } });
    await db.roleFieldGrant.deleteMany({ where: { roleId: oldRole.id } });
    await db.role.delete({ where: { id: oldRole.id } });
  }

  // 4. Report the end state, and shout if nobody can administer the system.
  const finalRoles = await db.role.findMany({ select: { key: true, name: true } });
  console.log(`\nRoles now: ${finalRoles.map((r) => r.key).sort().join(", ")}`);

  const adminRole = await db.role.findUnique({ where: { key: "admin" } });
  const adminCount = adminRole ? await db.userRole.count({ where: { roleId: adminRole.id } }) : 0;
  console.log(`Accounts with Admin: ${adminCount}`);
  if (apply && adminCount === 0) {
    console.error("\nWARNING: no account holds Admin. Nobody can reach Administration.");
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
