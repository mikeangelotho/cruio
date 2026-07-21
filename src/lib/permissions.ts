import { createAccessControl } from "better-auth/plugins/access";
import {
  defaultStatements,
  adminAc,
  ownerAc,
} from "better-auth/plugins/organization/access";

// Isomorphic access-control definition shared by the server auth config,
// the auth client, and UI gating (store.can). Server checks are the wall;
// client checks only hide affordances.
const statement = {
  ...defaultStatements,
  project: ["create", "read", "update", "delete", "share"],
  deliverable: ["create", "update", "move", "delete"],
  version: ["upload", "delete"],
  annotation: ["create", "comment", "resolve", "delete"],
  approval: ["decide"],
  entity: ["manage"],
  library: ["read", "upload", "manage"],
  task: ["create", "update", "assign", "delete"],
} as const;

export const ac = createAccessControl(statement);

export const guest = ac.newRole({
  project: ["read"],
  annotation: ["create", "comment", "resolve", "delete"],
  approval: ["decide"],
  // read = shared-project folders only; enforced server-side in guard.ts
  library: ["read"],
});

export const member = ac.newRole({
  project: ["read"],
  deliverable: ["create", "update", "move", "delete"],
  version: ["upload", "delete"],
  annotation: ["create", "comment", "resolve", "delete"],
  approval: ["decide"],
  library: ["read", "upload"],
  task: ["create", "update", "assign", "delete"],
});

export const admin = ac.newRole({
  ...adminAc.statements,
  project: ["create", "read", "update", "delete", "share"],
  deliverable: ["create", "update", "move", "delete"],
  version: ["upload", "delete"],
  annotation: ["create", "comment", "resolve", "delete"],
  approval: ["decide"],
  entity: ["manage"],
  library: ["read", "upload", "manage"],
  task: ["create", "update", "assign", "delete"],
});

export const owner = ac.newRole({
  ...ownerAc.statements,
  project: ["create", "read", "update", "delete", "share"],
  deliverable: ["create", "update", "move", "delete"],
  version: ["upload", "delete"],
  annotation: ["create", "comment", "resolve", "delete"],
  approval: ["decide"],
  entity: ["manage"],
  library: ["read", "upload", "manage"],
  task: ["create", "update", "assign", "delete"],
});

export const roles = { owner, admin, member, guest };

export type OrgRole = keyof typeof roles;

export type Resource = keyof typeof statement;

/** Client-side convenience: can `role` perform `action` on `resource`? */
export function can(
  role: OrgRole | undefined,
  resource: Resource,
  action: string,
): boolean {
  if (!role) return false;
  const r = roles[role];
  if (!r) return false;
  const res = r.authorize({ [resource]: [action] } as never);
  return res.success;
}
