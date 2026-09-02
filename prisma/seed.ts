/**
 * Development seed — Phase 1: departments, roles, permissions, demo users.
 * Later phases append vehicles, episodes, and workflow data.
 *
 * DEMO CREDENTIALS ARE FOR LOCAL DEVELOPMENT ONLY. Never use them in production.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { ROLE_TEMPLATES } from "../src/lib/authz/registry";

const db = new PrismaClient();

export const DEMO_PASSWORD = "GcccDemo!2026"; // development-only

const DEPARTMENTS = [
  { key: "operations", name: "Operations" },
  { key: "mechanical", name: "Mechanical" },
  { key: "detailing", name: "Detailing" },
  { key: "body", name: "Body & Paint" },
  { key: "media", name: "Media & Marketing" },
  { key: "sales", name: "Sales" },
  { key: "finance", name: "Finance & Title" },
  { key: "transport", name: "Transport" },
];

const DEMO_USERS: {
  email: string;
  name: string;
  roles: string[];
  departments: string[];
  active?: boolean;
}[] = [
  // Demo fixtures only. The real Gold Country accounts are created by an admin
  // in Administration -> Users, so that nobody's password lives in source
  // control. These twelve exist to give the sample vehicles a believable cast
  // and should be disabled before real inventory is entered.
  { email: "jade@demo.gccc", name: "Jade Southworth (Demo)", roles: ["admin"], departments: ["operations"] },
  { email: "sergio@demo.gccc", name: "Sergio Edell (Demo)", roles: ["admin"], departments: ["sales"] },
  { email: "ops@demo.gccc", name: "Olivia Operations", roles: ["front_desk"], departments: ["operations"] },
  { email: "mechanic@demo.gccc", name: "Mike Mechanic", roles: ["shop"], departments: ["mechanical"] },
  { email: "detailer@demo.gccc", name: "Dana Detailer", roles: ["shop"], departments: ["detailing"] },
  { email: "body@demo.gccc", name: "Bella Bodywork", roles: ["shop"], departments: ["body"] },
  { email: "media@demo.gccc", name: "Marco Media", roles: ["shop"], departments: ["media"] },
  { email: "sales@demo.gccc", name: "Sam Salesperson", roles: ["front_desk"], departments: ["sales"] },
  { email: "finance@demo.gccc", name: "Fiona Finance", roles: ["front_desk"], departments: ["finance"] },
  { email: "transport@demo.gccc", name: "Terry Transport", roles: ["front_desk"], departments: ["transport"] },
  { email: "vendor@demo.gccc", name: "Vinny's Upholstery (Vendor)", roles: ["shop"], departments: [] },
  { email: "disabled@demo.gccc", name: "Dee Disabled", roles: ["shop"], departments: ["mechanical"], active: false },
];

export async function seedFoundation() {
  // Departments
  const deptByKey = new Map<string, string>();
  for (const d of DEPARTMENTS) {
    const dept = await db.department.upsert({
      where: { key: d.key },
      update: { name: d.name },
      create: d,
    });
    deptByKey.set(d.key, dept.id);
  }

  // Roles + grants from templates
  for (const tpl of ROLE_TEMPLATES) {
    const role = await db.role.upsert({
      where: { key: tpl.key },
      update: { name: tpl.name, description: tpl.description, isSystem: true },
      create: { key: tpl.key, name: tpl.name, description: tpl.description, isSystem: true },
    });
    // Reset grants to template defaults (seed is authoritative in development).
    await db.rolePermission.deleteMany({ where: { roleId: role.id } });
    await db.roleFieldGrant.deleteMany({ where: { roleId: role.id } });
    const permRows = [];
    for (const [resource, grant] of Object.entries(tpl.grants)) {
      for (const [action, scope] of Object.entries(grant)) {
        permRows.push({ roleId: role.id, resource, action, scope });
      }
    }
    if (permRows.length) await db.rolePermission.createMany({ data: permRows });
    if (tpl.fieldGrants.length) {
      await db.roleFieldGrant.createMany({
        data: tpl.fieldGrants.map((fieldKey) => ({ roleId: role.id, fieldKey })),
      });
    }
  }

  // Demo users
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  for (const u of DEMO_USERS) {
    const user = await db.user.upsert({
      where: { email: u.email },
      update: { name: u.name, active: u.active ?? true },
      create: {
        email: u.email,
        name: u.name,
        passwordHash,
        active: u.active ?? true,
        primaryDepartmentId: u.departments[0] ? deptByKey.get(u.departments[0]) : undefined,
      },
    });
    await db.userRole.deleteMany({ where: { userId: user.id } });
    for (const roleKey of u.roles) {
      const role = await db.role.findUniqueOrThrow({ where: { key: roleKey } });
      await db.userRole.create({ data: { userId: user.id, roleId: role.id } });
    }
    await db.userDepartment.deleteMany({ where: { userId: user.id } });
    for (const deptKey of u.departments) {
      const deptId = deptByKey.get(deptKey);
      if (deptId) await db.userDepartment.create({ data: { userId: user.id, departmentId: deptId } });
    }
  }

  console.log(`Seeded ${DEPARTMENTS.length} departments, ${ROLE_TEMPLATES.length} roles, ${DEMO_USERS.length} demo users.`);
  console.log(`Demo password (development only): ${DEMO_PASSWORD}`);
}

async function main() {
  await seedFoundation();
  const { runPhase2Seed } = await import("./seed-phase2");
  await runPhase2Seed();
  const { runPhase3Seed } = await import("./seed-phase3");
  await runPhase3Seed();
  const { runPhase4Seed } = await import("./seed-phase4");
  await runPhase4Seed();
  const { runPhase5Seed } = await import("./seed-phase5");
  await runPhase5Seed();
  const { runPhase6Seed } = await import("./seed-phase6");
  await runPhase6Seed();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
