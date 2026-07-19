import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { query, redirect } from "@solidjs/router";
import { getRequestEvent } from "solid-js/web";
import { auth } from "./auth";
import { getDb } from "../db";
import {
  clients,
  invitation,
  invitationGrants,
  member,
  organization,
  projects,
  projectShares,
  user,
} from "../db/schema";
import {
  authorize,
  getSession,
  requireMember,
  requireSession,
} from "./guard";
import type { Client, OrgRole } from "./types";

export interface MemberRow {
  memberId: string;
  userId: string;
  name: string;
  email: string;
  role: OrgRole;
  createdAt: number;
  /** project ids shared with this user (only populated for guests) */
  sharedProjectIds: string[];
}

export interface InvitationRow {
  id: string;
  email: string;
  role: OrgRole;
  status: string;
  expiresAt: number;
  projectIds: string[];
}

function headers(): Headers {
  return getRequestEvent()!.request.headers;
}

/** Route-guard helper: current session user, or null when signed out. */
export async function getSessionUser() {
  "use server";
  return getSession();
}

/** Orgs the current user belongs to, with their role in each. */
export async function getMyOrganizations(): Promise<
  { id: string; name: string; slug: string; role: OrgRole }[]
> {
  "use server";
  const session = await requireSession();
  const db = await getDb();
  const rows = await db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      role: member.role,
    })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, session.userId));
  return rows.map((r) => ({ ...r, role: r.role as OrgRole }));
}

// query()-wrapped guards for route preload/createAsync (middleware-free
// route guarding; server functions remain the real wall).
export const sessionQuery = query(getSessionUser, "session-user");
export const myOrgsQuery = query(getMyOrganizations, "my-orgs");

export const requireUserQuery = query(async () => {
  const s = await getSessionUser();
  if (!s) throw redirect("/sign-in");
  return s;
}, "require-user");

export async function listMembers(orgId: string): Promise<MemberRow[]> {
  "use server";
  const { role } = await requireMember(orgId);
  authorize(role, "member", "update");
  const db = await getDb();
  const rows = await db
    .select({
      memberId: member.id,
      userId: member.userId,
      role: member.role,
      createdAt: member.createdAt,
      name: user.name,
      email: user.email,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, orgId))
    .orderBy(asc(member.createdAt));

  const guestIds = rows.filter((r) => r.role === "guest").map((r) => r.userId);
  const shares = guestIds.length
    ? await db
        .select({ userId: projectShares.userId, projectId: projectShares.projectId })
        .from(projectShares)
        .innerJoin(projects, eq(projects.id, projectShares.projectId))
        .where(
          and(
            eq(projects.organizationId, orgId),
            inArray(projectShares.userId, guestIds),
          ),
        )
    : [];

  return rows.map((r) => ({
    ...r,
    role: r.role as OrgRole,
    createdAt: Number(r.createdAt),
    sharedProjectIds: shares
      .filter((s) => s.userId === r.userId)
      .map((s) => s.projectId),
  }));
}

export async function updateMemberRole(
  orgId: string,
  memberId: string,
  role: OrgRole,
): Promise<void> {
  "use server";
  // Delegated: the org plugin enforces its own access control (incl. owner rules).
  await auth.api.updateMemberRole({
    body: { memberId, role, organizationId: orgId },
    headers: headers(),
  });
}

export async function removeMember(
  orgId: string,
  memberId: string,
): Promise<void> {
  "use server";
  await auth.api.removeMember({
    body: { memberIdOrEmail: memberId, organizationId: orgId },
    headers: headers(),
  });
}

export async function listInvitations(orgId: string): Promise<InvitationRow[]> {
  "use server";
  const { role } = await requireMember(orgId);
  authorize(role, "invitation", "create");
  const db = await getDb();
  const rows = await db
    .select()
    .from(invitation)
    .where(and(eq(invitation.organizationId, orgId), eq(invitation.status, "pending")))
    .orderBy(asc(invitation.createdAt));
  const ids = rows.map((r) => r.id);
  const grants = ids.length
    ? await db
        .select()
        .from(invitationGrants)
        .where(inArray(invitationGrants.invitationId, ids))
    : [];
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    role: (r.role ?? "member") as OrgRole,
    status: r.status,
    expiresAt: Number(r.expiresAt),
    projectIds: grants
      .filter((g) => g.invitationId === r.id)
      .map((g) => g.projectId),
  }));
}

export async function cancelInvitation(invitationId: string): Promise<void> {
  "use server";
  await auth.api.cancelInvitation({
    body: { invitationId },
    headers: headers(),
  });
}

/** Attach project scope to a pending guest invitation. Admin+ only. */
export async function grantInvitationProjects(
  invitationId: string,
  projectIds: string[],
): Promise<void> {
  "use server";
  const db = await getDb();
  const [inv] = await db
    .select()
    .from(invitation)
    .where(eq(invitation.id, invitationId));
  if (!inv) throw new Error("Not found");
  const { role } = await requireMember(inv.organizationId);
  authorize(role, "invitation", "create");

  // Only projects of the invitation's org can be granted.
  const orgProjects = projectIds.length
    ? await db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.organizationId, inv.organizationId),
            inArray(projects.id, projectIds),
          ),
        )
    : [];
  await db
    .delete(invitationGrants)
    .where(eq(invitationGrants.invitationId, invitationId));
  if (orgProjects.length) {
    await db.insert(invitationGrants).values(
      orgProjects.map((p) => ({
        id: randomUUID(),
        invitationId,
        projectId: p.id,
      })),
    );
  }
}

/**
 * After accepting an invitation, copy its project grants into project_shares
 * for the accepting user. Verifies the invitation was accepted by this user.
 */
export async function claimInvitationGrants(invitationId: string): Promise<void> {
  "use server";
  const session = await requireSession();
  const db = await getDb();
  const [inv] = await db
    .select()
    .from(invitation)
    .where(eq(invitation.id, invitationId));
  if (!inv) throw new Error("Not found");
  if (inv.status !== "accepted") throw new Error("Invitation not accepted");
  if (inv.email.toLowerCase() !== session.email.toLowerCase())
    throw new Error("Forbidden");

  const grants = await db
    .select()
    .from(invitationGrants)
    .where(eq(invitationGrants.invitationId, invitationId));
  for (const g of grants) {
    const [existing] = await db
      .select({ id: projectShares.id })
      .from(projectShares)
      .where(
        and(
          eq(projectShares.projectId, g.projectId),
          eq(projectShares.userId, session.userId),
        ),
      );
    if (!existing) {
      await db.insert(projectShares).values({
        id: randomUUID(),
        projectId: g.projectId,
        userId: session.userId,
        createdAt: Date.now(),
      });
    }
  }
}

/** Public (signed-out reachable) invitation info for the accept page. */
export async function getInvitationPublic(invitationId: string): Promise<{
  id: string;
  email: string;
  role: OrgRole;
  status: string;
  expiresAt: number;
  organizationId: string;
  organizationName: string;
  inviterName: string;
} | null> {
  "use server";
  const db = await getDb();
  const [row] = await db
    .select({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      organizationId: invitation.organizationId,
      organizationName: organization.name,
      inviterName: user.name,
    })
    .from(invitation)
    .innerJoin(organization, eq(organization.id, invitation.organizationId))
    .innerJoin(user, eq(user.id, invitation.inviterId))
    .where(eq(invitation.id, invitationId));
  if (!row) return null;
  return {
    ...row,
    role: (row.role ?? "member") as OrgRole,
    expiresAt: Number(row.expiresAt),
  };
}

// ---- clients (org-level client companies / departments) --------------------

/** All clients of the active org. Any member may list (needed for display). */
export async function listClients(): Promise<Client[]> {
  "use server";
  const session = await requireSession();
  const orgId = session.activeOrganizationId;
  if (!orgId) return [];
  await requireMember(orgId);
  const db = await getDb();
  const rows = await db
    .select()
    .from(clients)
    .where(eq(clients.organizationId, orgId))
    .orderBy(asc(clients.name));
  const counts = await db
    .select({ clientId: projects.clientId })
    .from(projects)
    .where(eq(projects.organizationId, orgId));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    projectCount: counts.filter((c) => c.clientId === r.id).length,
  }));
}

export async function createClient(name: string): Promise<Client> {
  "use server";
  const session = await requireSession();
  const orgId = session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");
  const { role } = await requireMember(orgId);
  authorize(role, "client", "manage");
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Client name is required");
  const db = await getDb();
  // reuse an existing client with the same name instead of duplicating
  const [existing] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.organizationId, orgId), eq(clients.name, trimmed)));
  if (existing) return { id: existing.id, name: existing.name };
  const row = {
    id: randomUUID(),
    organizationId: orgId,
    name: trimmed,
    createdAt: Date.now(),
  };
  await db.insert(clients).values(row);
  return { id: row.id, name: row.name };
}

export async function renameClient(id: string, name: string): Promise<void> {
  "use server";
  const db = await getDb();
  const [row] = await db.select().from(clients).where(eq(clients.id, id));
  if (!row) throw new Error("Not found");
  const { role } = await requireMember(row.organizationId);
  authorize(role, "client", "manage");
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Client name is required");
  await db.update(clients).set({ name: trimmed }).where(eq(clients.id, id));
}

/** Deleting a client detaches its projects (they keep working, unassigned). */
export async function deleteClient(id: string): Promise<void> {
  "use server";
  const db = await getDb();
  const [row] = await db.select().from(clients).where(eq(clients.id, id));
  if (!row) throw new Error("Not found");
  const { role } = await requireMember(row.organizationId);
  authorize(role, "client", "manage");
  await db.update(projects).set({ clientId: null }).where(eq(projects.clientId, id));
  await db.delete(clients).where(eq(clients.id, id));
}

export async function shareProject(
  projectId: string,
  userId: string,
): Promise<void> {
  "use server";
  const db = await getDb();
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!project) throw new Error("Not found");
  const { role } = await requireMember(project.organizationId);
  authorize(role, "project", "share");
  const [existing] = await db
    .select({ id: projectShares.id })
    .from(projectShares)
    .where(
      and(eq(projectShares.projectId, projectId), eq(projectShares.userId, userId)),
    );
  if (!existing) {
    await db.insert(projectShares).values({
      id: randomUUID(),
      projectId,
      userId,
      createdAt: Date.now(),
    });
  }
}

export async function unshareProject(
  projectId: string,
  userId: string,
): Promise<void> {
  "use server";
  const db = await getDb();
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!project) throw new Error("Not found");
  const { role } = await requireMember(project.organizationId);
  authorize(role, "project", "share");
  await db
    .delete(projectShares)
    .where(
      and(eq(projectShares.projectId, projectId), eq(projectShares.userId, userId)),
    );
}
