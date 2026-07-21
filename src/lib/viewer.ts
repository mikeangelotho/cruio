import { createMemo } from "solid-js";
import type { OrgRole } from "./types";

interface OrgLike {
  id: string;
  name: string;
  role: OrgRole;
}

/**
 * Derives the signed-in user's role in their active org from the `user` /
 * `orgs` accessors every page already has via requireUserQuery/myOrgsQuery
 * (cheap to call again — Solid's router query cache dedupes the fetch).
 * Centralizes the activeOrg/role/isAdmin/isGuest math that used to be
 * copy-pasted across AppNav, AppFooter, and every top-level route.
 */
export function useViewerRole(
  user: () => { activeOrganizationId?: string | null } | undefined,
  orgs: () => OrgLike[] | undefined,
) {
  const activeOrg = createMemo(() =>
    orgs()?.find(o => o.id === user()?.activeOrganizationId),
  );
  const myRole = () => activeOrg()?.role;
  const isAdmin = () => myRole() === "admin" || myRole() === "owner";
  const isGuest = () => myRole() === "guest";
  return { activeOrg, myRole, isAdmin, isGuest };
}
