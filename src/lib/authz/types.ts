import type { Action, Resource, Scope } from "./registry";

/** Fully resolved, request-scoped view of the authenticated user. */
export interface SessionUser {
  id: string;
  sessionId: string;
  name: string;
  email: string;
  /** Real role keys on the account. */
  roleKeys: string[];
  /** True when the real account holds the owner role (regardless of preview). */
  isOwner: boolean;
  /** Active "Preview as Role" key, or null. Only owners can preview. */
  previewRoleKey: string | null;
  departmentIds: string[];
  departmentKeys: string[];
  /**
   * Effective permission map: "resource:action" -> scope.
   * When previewing, this reflects the previewed role, not the owner.
   */
  permissions: ReadonlyMap<string, Scope>;
  /** Effective sensitive-field grants (preview-aware). */
  fieldGrants: ReadonlySet<string>;
  defaultLandingPage: string | null;
}

/** Record context supplied when a decision depends on the specific record. */
export interface RecordContext {
  /** User IDs assigned to the record (tasks, work orders, deals, inspections…). */
  assignedUserIds?: string[];
  /** Department keys associated with the record. */
  departmentKeys?: string[];
  /** Who created the record. */
  createdById?: string;
}

export type { Action, Resource, Scope };
