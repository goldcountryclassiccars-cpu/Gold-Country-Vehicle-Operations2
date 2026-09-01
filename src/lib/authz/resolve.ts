import { SCOPE_RANK, type Scope } from "./registry";

export interface RoleGrantsShape {
  key: string;
  permissions: { resource: string; action: string; scope: Scope }[];
  fieldGrants: { fieldKey: string }[];
}

/** Unions permissions across roles — the strongest scope wins per (resource, action). */
export function buildPermissionMap(roles: RoleGrantsShape[]): {
  permissions: Map<string, Scope>;
  fieldGrants: Set<string>;
} {
  const permissions = new Map<string, Scope>();
  const fieldGrants = new Set<string>();
  for (const role of roles) {
    for (const p of role.permissions) {
      const key = `${p.resource}:${p.action}`;
      const existing = permissions.get(key);
      if (!existing || SCOPE_RANK[p.scope] > SCOPE_RANK[existing]) {
        permissions.set(key, p.scope);
      }
    }
    for (const fg of role.fieldGrants) fieldGrants.add(fg.fieldKey);
  }
  return { permissions, fieldGrants };
}
