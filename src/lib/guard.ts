import { redirect } from "@solidjs/router";
import { getRequestEvent } from "solid-js/web";
import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { auth } from "./auth";
import { getDb } from "~/db";
import {
  annotations,
  approvals,
  deliverables,
  history,
  member,
  projects,
  projectShares,
  versions,
} from "~/db/schema";
import { roles, type OrgRole, type Resource } from "./permissions";
import type { DeliverableStatus, HistoryType } from "./types";

// Server-only authorization helpers, called at the top of every "use server"
// function and raw API route. These are the real wall; UI gating is cosmetic.

export type SessionInfo = {
  userId: string;
  name: string;
  email: string;
  activeOrganizationId: string | null;
};

/** Headers can be passed explicitly by raw Nitro routes (upload/files). */
export async function getSession(
  headers?: Headers,
): Promise<SessionInfo | null> {
  const h = headers ?? getRequestEvent()?.request.headers;
  if (!h) return null;
  const res = await auth.api.getSession({ headers: h });
  if (!res) return null;
  return {
    userId: res.user.id,
    name: res.user.name,
    email: res.user.email,
    activeOrganizationId:
      (res.session as { activeOrganizationId?: string | null })
        .activeOrganizationId ?? null,
  };
}

export async function requireSession(headers?: Headers): Promise<SessionInfo> {
  const session = await getSession(headers);
  if (!session) throw redirect("/sign-in");
  return session;
}

export function authorize(role: OrgRole, resource: Resource, action: string) {
  const r = roles[role];
  const ok = r && r.authorize({ [resource]: [action] } as never).success;
  if (!ok) throw new Error("Forbidden");
}

/** Membership + role of the current user in `orgId`. Throws if not a member. */
export async function requireMember(
  orgId: string,
  headers?: Headers,
): Promise<{ session: SessionInfo; role: OrgRole }> {
  const session = await requireSession(headers);
  const db = await getDb();
  const [row] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.userId, session.userId)));
  if (!row) throw new Error("Forbidden");
  return { session, role: row.role as OrgRole };
}

/**
 * Project access check: project → org → member row; guests additionally need
 * a project_shares row. Optional `perm` authorizes locally (no extra queries).
 */
export async function requireProjectAccess(
  projectId: string,
  perm?: { resource: Resource; action: string },
  headers?: Headers,
): Promise<{
  session: SessionInfo;
  role: OrgRole;
  project: typeof projects.$inferSelect;
}> {
  const session = await requireSession(headers);
  const db = await getDb();
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!project) throw new Error("Not found");
  const [m] = await db
    .select({ role: member.role })
    .from(member)
    .where(
      and(
        eq(member.organizationId, project.organizationId),
        eq(member.userId, session.userId),
      ),
    );
  if (!m) throw new Error("Forbidden");
  const role = m.role as OrgRole;
  if (role === "guest") {
    const [share] = await db
      .select({ id: projectShares.id })
      .from(projectShares)
      .where(
        and(
          eq(projectShares.projectId, projectId),
          eq(projectShares.userId, session.userId),
        ),
      );
    if (!share) throw new Error("Forbidden");
  }
  if (perm) authorize(role, perm.resource, perm.action);
  return { session, role, project };
}

export async function resolveDeliverableProject(
  deliverableId: string,
): Promise<string> {
  const db = await getDb();
  const [d] = await db
    .select({ projectId: deliverables.projectId })
    .from(deliverables)
    .where(eq(deliverables.id, deliverableId));
  if (!d) throw new Error("Not found");
  return d.projectId;
}

export async function resolveAnnotationProject(
  annotationId: string,
): Promise<string> {
  const db = await getDb();
  const [a] = await db
    .select({ deliverableId: annotations.deliverableId })
    .from(annotations)
    .where(eq(annotations.id, annotationId));
  if (!a) throw new Error("Not found");
  return resolveDeliverableProject(a.deliverableId);
}

type Db = Awaited<ReturnType<typeof getDb>>;

/** Append an entry to the project's activity log. */
export async function recordHistory(
  db: Db,
  e: {
    projectId: string;
    deliverableId?: string | null;
    subjectId?: string | null;
    userId: string;
    actorName: string;
    type: HistoryType;
    detail: string;
  },
): Promise<void> {
  await db.insert(history).values({
    id: randomUUID(),
    projectId: e.projectId,
    deliverableId: e.deliverableId ?? null,
    subjectId: e.subjectId ?? null,
    userId: e.userId,
    actorName: e.actorName,
    type: e.type,
    detail: e.detail,
    createdAt: Date.now(),
  });
}

/** Recompute a deliverable's status from its remaining (non-deleted) versions. */
export async function recomputeStatus(db: Db, deliverableId: string): Promise<void> {
  const vs = await db
    .select()
    .from(versions)
    .where(and(eq(versions.deliverableId, deliverableId), isNull(versions.deletedAt)))
    .orderBy(asc(versions.number));
  const last = vs[vs.length - 1];
  let status: DeliverableStatus = "draft";
  if (last) {
    const aps = await db
      .select()
      .from(approvals)
      .where(eq(approvals.versionId, last.id))
      .orderBy(asc(approvals.createdAt));
    const lastAp = aps[aps.length - 1];
    status = lastAp
      ? lastAp.decision === "approved"
        ? "approved"
        : "revisions_requested"
      : "in_review";
  }
  await db.update(deliverables).set({ status }).where(eq(deliverables.id, deliverableId));
}

export async function resolveVersionProject(
  fileName: string,
): Promise<string | null> {
  const db = await getDb();
  const [v] = await db
    .select({ deliverableId: versions.deliverableId })
    .from(versions)
    .where(eq(versions.fileName, fileName));
  if (!v) return null;
  return resolveDeliverableProject(v.deliverableId);
}
