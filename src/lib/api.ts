import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "../db";
import {
  annotations,
  approvals,
  clients,
  comments,
  deliverables,
  history,
  projects,
  projectShares,
  versions,
} from "../db/schema";
import type {
  Annotation,
  AnnotationStatus,
  Decision,
  Deliverable,
  DeliverableStatus,
  HistoryEntry,
  Phase,
  Project,
  ProjectGraph,
} from "./types";
import {
  authorize,
  recomputeStatus,
  recordHistory,
  requireMember,
  requireProjectAccess,
  requireSession,
  resolveAnnotationProject,
  resolveDeliverableProject,
} from "./guard";

export async function listProjects(): Promise<Project[]> {
  "use server";
  const session = await requireSession();
  const orgId = session.activeOrganizationId;
  if (!orgId) return [];
  const { role } = await requireMember(orgId);
  const db = await getDb();

  const rows =
    role === "guest"
      ? await db
          .select({ p: projects, clientName: clients.name })
          .from(projects)
          .leftJoin(clients, eq(clients.id, projects.clientId))
          .innerJoin(
            projectShares,
            and(
              eq(projectShares.projectId, projects.id),
              eq(projectShares.userId, session.userId),
            ),
          )
          .where(and(eq(projects.organizationId, orgId), isNull(projects.archivedAt)))
          .orderBy(desc(projects.createdAt))
      : await db
          .select({ p: projects, clientName: clients.name })
          .from(projects)
          .leftJoin(clients, eq(clients.id, projects.clientId))
          .where(and(eq(projects.organizationId, orgId), isNull(projects.archivedAt)))
          .orderBy(desc(projects.createdAt));

  const ids = rows.map((r) => r.p.id);
  const counts = ids.length
    ? await db
        .select({ projectId: deliverables.projectId, id: deliverables.id })
        .from(deliverables)
        .where(and(inArray(deliverables.projectId, ids), isNull(deliverables.deletedAt)))
    : [];
  return rows.map((r) => ({
    ...(r.p as unknown as Project),
    clientName: r.clientName ?? null,
    phase: r.p.phase as Phase,
    deliverableCount: counts.filter((c) => c.projectId === r.p.id).length,
  }));
}

export async function createProject(
  id: string,
  name: string,
  clientId: string | null,
): Promise<void> {
  "use server";
  const session = await requireSession();
  const orgId = session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");
  const { role } = await requireMember(orgId);
  authorize(role, "project", "create");
  const db = await getDb();
  if (clientId) {
    const [c] = await db
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.id, clientId), eq(clients.organizationId, orgId)));
    if (!c) throw new Error("Unknown client");
  }
  await db.insert(projects).values({
    id,
    organizationId: orgId,
    name,
    clientId,
    createdBy: session.userId,
    createdAt: Date.now(),
  });
  await recordHistory(db, {
    projectId: id,
    userId: session.userId,
    actorName: session.name,
    type: "project_created",
    detail: "created the project",
  });
}

export async function getProjectGraph(
  projectId: string,
): Promise<ProjectGraph | null> {
  "use server";
  const { session, role, project } = await requireProjectAccess(projectId);
  // archived projects are only reachable by admins (to review before restore)
  if (project.archivedAt && role !== "admin" && role !== "owner") return null;
  const db = await getDb();

  let clientName: string | null = null;
  if (project.clientId) {
    const [c] = await db
      .select({ name: clients.name })
      .from(clients)
      .where(eq(clients.id, project.clientId));
    clientName = c?.name ?? null;
  }

  const dRows = await db
    .select()
    .from(deliverables)
    .where(and(eq(deliverables.projectId, projectId), isNull(deliverables.deletedAt)))
    .orderBy(asc(deliverables.createdAt));

  const dIds = dRows.map(d => d.id);
  const vRows = dIds.length
    ? await db
        .select()
        .from(versions)
        .where(and(inArray(versions.deliverableId, dIds), isNull(versions.deletedAt)))
        .orderBy(asc(versions.number))
    : [];
  const visibleVersionIds = new Set(vRows.map(v => v.id));
  const aRows = (dIds.length
    ? await db.select().from(annotations).where(inArray(annotations.deliverableId, dIds)).orderBy(asc(annotations.createdAt))
    : []
  ).filter(a => visibleVersionIds.has(a.versionId));
  const aIds = aRows.map(a => a.id);
  const cRows = aIds.length
    ? await db.select().from(comments).where(inArray(comments.annotationId, aIds)).orderBy(asc(comments.createdAt))
    : [];
  const apRows = dIds.length
    ? await db.select().from(approvals).where(inArray(approvals.deliverableId, dIds)).orderBy(asc(approvals.createdAt))
    : [];

  const graph: ProjectGraph = {
    project: { ...(project as unknown as Project), clientName, phase: project.phase as Phase },
    viewer: { userId: session.userId, name: session.name, role },
    deliverables: dRows.map(d => ({
      ...(d as unknown as Deliverable),
      status: d.status as DeliverableStatus,
      versions: vRows.filter(v => v.deliverableId === d.id),
      annotations: aRows
        .filter(a => a.deliverableId === d.id)
        .map(a => ({
          ...(a as unknown as Annotation),
          status: a.status as AnnotationStatus,
          comments: cRows.filter(c => c.annotationId === a.id),
        })),
      approvals: apRows.filter(ap => ap.deliverableId === d.id).map(ap => ({
        ...ap,
        decision: ap.decision as Decision,
      })),
    })),
  };
  return graph;
}

export async function createDeliverable(
  id: string,
  projectId: string,
  name: string,
  posX: number,
  posY: number,
  spec = ""
): Promise<void> {
  "use server";
  const { session } = await requireProjectAccess(projectId, { resource: "deliverable", action: "create" });
  const db = await getDb();
  await db.insert(deliverables).values({ id, projectId, name, spec, posX, posY, createdAt: Date.now() });
  await recordHistory(db, {
    projectId,
    deliverableId: id,
    subjectId: id,
    userId: session.userId,
    actorName: session.name,
    type: "deliverable_created",
    detail: `added “${name}”`,
  });
}

export async function moveDeliverable(id: string, posX: number, posY: number): Promise<void> {
  "use server";
  const projectId = await resolveDeliverableProject(id);
  await requireProjectAccess(projectId, { resource: "deliverable", action: "move" });
  const db = await getDb();
  await db.update(deliverables).set({ posX, posY }).where(eq(deliverables.id, id));
}

export async function renameDeliverable(id: string, name: string): Promise<void> {
  "use server";
  const projectId = await resolveDeliverableProject(id);
  const { session } = await requireProjectAccess(projectId, { resource: "deliverable", action: "update" });
  const db = await getDb();
  const [prev] = await db.select({ name: deliverables.name }).from(deliverables).where(eq(deliverables.id, id));
  await db.update(deliverables).set({ name }).where(eq(deliverables.id, id));
  if (prev && prev.name !== name) {
    await recordHistory(db, {
      projectId,
      deliverableId: id,
      subjectId: id,
      userId: session.userId,
      actorName: session.name,
      type: "deliverable_renamed",
      detail: `renamed “${prev.name}” to “${name}”`,
    });
  }
}

export async function createAnnotation(
  id: string,
  deliverableId: string,
  versionId: string,
  x: number,
  y: number
): Promise<void> {
  "use server";
  const projectId = await resolveDeliverableProject(deliverableId);
  const { session } = await requireProjectAccess(projectId, {
    resource: "annotation",
    action: "create",
  });
  const db = await getDb();
  await db.insert(annotations).values({
    id,
    deliverableId,
    versionId,
    x,
    y,
    createdBy: session.userId,
    createdAt: Date.now(),
  });
}

export async function deleteAnnotation(id: string): Promise<void> {
  "use server";
  const projectId = await resolveAnnotationProject(id);
  await requireProjectAccess(projectId, { resource: "annotation", action: "delete" });
  const db = await getDb();
  await db.delete(comments).where(eq(comments.annotationId, id));
  await db.delete(annotations).where(eq(annotations.id, id));
}

export async function addComment(
  id: string,
  annotationId: string,
  body: string
): Promise<void> {
  "use server";
  const projectId = await resolveAnnotationProject(annotationId);
  const { session } = await requireProjectAccess(projectId, {
    resource: "annotation",
    action: "comment",
  });
  const db = await getDb();
  await db.insert(comments).values({
    id,
    annotationId,
    userId: session.userId,
    authorName: session.name,
    body,
    createdAt: Date.now(),
  });
  const [ann] = await db
    .select({ deliverableId: annotations.deliverableId })
    .from(annotations)
    .where(eq(annotations.id, annotationId));
  const [d] = ann
    ? await db.select({ name: deliverables.name }).from(deliverables).where(eq(deliverables.id, ann.deliverableId))
    : [];
  const excerpt = body.length > 80 ? `${body.slice(0, 77)}…` : body;
  await recordHistory(db, {
    projectId,
    deliverableId: ann?.deliverableId,
    subjectId: annotationId,
    userId: session.userId,
    actorName: session.name,
    type: "comment_added",
    detail: `commented on “${d?.name ?? "a deliverable"}”: “${excerpt}”`,
  });
}

export async function resolveAnnotation(id: string, status: AnnotationStatus): Promise<void> {
  "use server";
  const projectId = await resolveAnnotationProject(id);
  const { session } = await requireProjectAccess(projectId, { resource: "annotation", action: "resolve" });
  const db = await getDb();
  await db.update(annotations).set({ status }).where(eq(annotations.id, id));
  const [ann] = await db
    .select({ deliverableId: annotations.deliverableId })
    .from(annotations)
    .where(eq(annotations.id, id));
  const [d] = ann
    ? await db.select({ name: deliverables.name }).from(deliverables).where(eq(deliverables.id, ann.deliverableId))
    : [];
  const name = d?.name ?? "a deliverable";
  await recordHistory(db, {
    projectId,
    deliverableId: ann?.deliverableId,
    subjectId: id,
    userId: session.userId,
    actorName: session.name,
    type: status === "open" ? "thread_reopened" : "thread_resolved",
    detail:
      status === "open"
        ? `reopened a thread on “${name}”`
        : `resolved a thread on “${name}” (${status === "resolved_approved" ? "approved" : "needs revision"})`,
  });
}

/**
 * Records an approval decision for a version and rolls the result up to the
 * deliverable status. Approve is rejected server-side while open threads exist.
 * Attribution comes from the session, never the client.
 */
export async function decideVersion(
  id: string,
  deliverableId: string,
  versionId: string,
  decision: Decision,
  note = ""
): Promise<{ ok: boolean; error?: string }> {
  "use server";
  const projectId = await resolveDeliverableProject(deliverableId);
  const { session } = await requireProjectAccess(projectId, {
    resource: "approval",
    action: "decide",
  });
  const db = await getDb();
  if (decision === "approved") {
    const open = await db
      .select({ id: annotations.id })
      .from(annotations)
      .where(and(eq(annotations.versionId, versionId), eq(annotations.status, "open")));
    if (open.length > 0) {
      return { ok: false, error: `${open.length} open thread(s) must be resolved before approval` };
    }
  }
  await db.insert(approvals).values({
    id,
    deliverableId,
    versionId,
    decision,
    userId: session.userId,
    approverName: session.name,
    note,
    createdAt: Date.now(),
  });
  await db
    .update(deliverables)
    .set({ status: decision === "approved" ? "approved" : "revisions_requested" })
    .where(eq(deliverables.id, deliverableId));

  const [v] = await db.select({ number: versions.number }).from(versions).where(eq(versions.id, versionId));
  const [d] = await db.select({ name: deliverables.name }).from(deliverables).where(eq(deliverables.id, deliverableId));
  const label = `v${v?.number ?? "?"} of “${d?.name ?? "a deliverable"}”`;
  const noteSuffix = note ? ` — “${note.length > 80 ? `${note.slice(0, 77)}…` : note}”` : "";
  await recordHistory(db, {
    projectId,
    deliverableId,
    subjectId: versionId,
    userId: session.userId,
    actorName: session.name,
    type: decision === "approved" ? "decision_approved" : "decision_revisions",
    detail:
      decision === "approved"
        ? `approved ${label}${noteSuffix}`
        : `requested revisions on ${label}${noteSuffix}`,
  });
  return { ok: true };
}

/** Soft-delete a version; the file and threads stay restorable from History. */
export async function deleteVersion(versionId: string): Promise<void> {
  "use server";
  const db = await getDb();
  const [v] = await db.select().from(versions).where(eq(versions.id, versionId));
  if (!v || v.deletedAt) throw new Error("Not found");
  const projectId = await resolveDeliverableProject(v.deliverableId);
  const { session } = await requireProjectAccess(projectId, {
    resource: "version",
    action: "delete",
  });
  await db
    .update(versions)
    .set({ deletedAt: Date.now(), deletedBy: session.userId })
    .where(eq(versions.id, versionId));
  await recomputeStatus(db, v.deliverableId);
  const [d] = await db
    .select({ name: deliverables.name })
    .from(deliverables)
    .where(eq(deliverables.id, v.deliverableId));
  await recordHistory(db, {
    projectId,
    deliverableId: v.deliverableId,
    subjectId: versionId,
    userId: session.userId,
    actorName: session.name,
    type: "version_deleted",
    detail: `deleted v${v.number} of “${d?.name ?? "a deliverable"}”`,
  });
}

export async function restoreVersion(versionId: string): Promise<void> {
  "use server";
  const db = await getDb();
  const [v] = await db.select().from(versions).where(eq(versions.id, versionId));
  if (!v || !v.deletedAt) throw new Error("Not found");
  const projectId = await resolveDeliverableProject(v.deliverableId);
  const { session } = await requireProjectAccess(projectId, {
    resource: "version",
    action: "delete",
  });
  await db
    .update(versions)
    .set({ deletedAt: null, deletedBy: null })
    .where(eq(versions.id, versionId));
  await recomputeStatus(db, v.deliverableId);
  const [d] = await db
    .select({ name: deliverables.name })
    .from(deliverables)
    .where(eq(deliverables.id, v.deliverableId));
  await recordHistory(db, {
    projectId,
    deliverableId: v.deliverableId,
    subjectId: versionId,
    userId: session.userId,
    actorName: session.name,
    type: "version_restored",
    detail: `restored v${v.number} of “${d?.name ?? "a deliverable"}”`,
  });
}

/** Soft-delete a deliverable (with all its versions/threads); restorable. */
export async function deleteDeliverable(id: string): Promise<void> {
  "use server";
  const projectId = await resolveDeliverableProject(id);
  const { session } = await requireProjectAccess(projectId, {
    resource: "deliverable",
    action: "delete",
  });
  const db = await getDb();
  const [d] = await db.select().from(deliverables).where(eq(deliverables.id, id));
  if (!d || d.deletedAt) throw new Error("Not found");
  await db
    .update(deliverables)
    .set({ deletedAt: Date.now(), deletedBy: session.userId })
    .where(eq(deliverables.id, id));
  await recordHistory(db, {
    projectId,
    deliverableId: id,
    subjectId: id,
    userId: session.userId,
    actorName: session.name,
    type: "deliverable_deleted",
    detail: `deleted “${d.name}”`,
  });
}

export async function restoreDeliverable(id: string): Promise<void> {
  "use server";
  const projectId = await resolveDeliverableProject(id);
  const { session } = await requireProjectAccess(projectId, {
    resource: "deliverable",
    action: "delete",
  });
  const db = await getDb();
  const [d] = await db.select().from(deliverables).where(eq(deliverables.id, id));
  if (!d || !d.deletedAt) throw new Error("Not found");
  await db
    .update(deliverables)
    .set({ deletedAt: null, deletedBy: null })
    .where(eq(deliverables.id, id));
  await recordHistory(db, {
    projectId,
    deliverableId: id,
    subjectId: id,
    userId: session.userId,
    actorName: session.name,
    type: "deliverable_restored",
    detail: `restored “${d.name}”`,
  });
}

/** Project activity log, newest first. Deleted-type entries carry `restorable`. */
export async function listHistory(projectId: string): Promise<HistoryEntry[]> {
  "use server";
  await requireProjectAccess(projectId);
  const db = await getDb();
  const rows = await db
    .select()
    .from(history)
    .where(eq(history.projectId, projectId))
    .orderBy(desc(history.createdAt))
    .limit(200);

  // which deleted subjects are still deleted (i.e. restorable)?
  const vIds = rows.filter(r => r.type === "version_deleted" && r.subjectId).map(r => r.subjectId!);
  const dIds = rows.filter(r => r.type === "deliverable_deleted" && r.subjectId).map(r => r.subjectId!);
  const stillDeletedV = new Set(
    vIds.length
      ? (
          await db
            .select({ id: versions.id, deletedAt: versions.deletedAt })
            .from(versions)
            .where(inArray(versions.id, vIds))
        )
          .filter(v => v.deletedAt != null)
          .map(v => v.id)
      : [],
  );
  const stillDeletedD = new Set(
    dIds.length
      ? (
          await db
            .select({ id: deliverables.id, deletedAt: deliverables.deletedAt })
            .from(deliverables)
            .where(inArray(deliverables.id, dIds))
        )
          .filter(d => d.deletedAt != null)
          .map(d => d.id)
      : [],
  );

  return rows.map(r => ({
    ...(r as unknown as HistoryEntry),
    restorable:
      r.type === "version_deleted"
        ? stillDeletedV.has(r.subjectId ?? "")
        : r.type === "deliverable_deleted"
          ? stillDeletedD.has(r.subjectId ?? "")
          : undefined,
  }));
}

/** Archive a project (admin+). It leaves all lists but is restorable. */
export async function archiveProject(id: string): Promise<void> {
  "use server";
  const session = await requireSession();
  const db = await getDb();
  const [p] = await db.select().from(projects).where(eq(projects.id, id));
  if (!p || p.archivedAt) throw new Error("Not found");
  const { role } = await requireMember(p.organizationId);
  authorize(role, "project", "delete");
  await db
    .update(projects)
    .set({ archivedAt: Date.now(), archivedBy: session.userId })
    .where(eq(projects.id, id));
  await recordHistory(db, {
    projectId: id,
    userId: session.userId,
    actorName: session.name,
    type: "project_archived",
    detail: `archived “${p.name}”`,
  });
}

export async function restoreProject(id: string): Promise<void> {
  "use server";
  const session = await requireSession();
  const db = await getDb();
  const [p] = await db.select().from(projects).where(eq(projects.id, id));
  if (!p || !p.archivedAt) throw new Error("Not found");
  const { role } = await requireMember(p.organizationId);
  authorize(role, "project", "delete");
  await db
    .update(projects)
    .set({ archivedAt: null, archivedBy: null })
    .where(eq(projects.id, id));
  await recordHistory(db, {
    projectId: id,
    userId: session.userId,
    actorName: session.name,
    type: "project_restored",
    detail: `restored “${p.name}”`,
  });
}

/** Archived projects of the active org. Empty for non-admins (no error). */
export async function listArchivedProjects(): Promise<Project[]> {
  "use server";
  const session = await requireSession();
  const orgId = session.activeOrganizationId;
  if (!orgId) return [];
  const { role } = await requireMember(orgId);
  if (role !== "admin" && role !== "owner") return [];
  const db = await getDb();
  const rows = await db
    .select({ p: projects, clientName: clients.name })
    .from(projects)
    .leftJoin(clients, eq(clients.id, projects.clientId))
    .where(eq(projects.organizationId, orgId))
    .orderBy(desc(projects.createdAt));
  return rows
    .filter(r => r.p.archivedAt != null)
    .map(r => ({
      ...(r.p as unknown as Project),
      clientName: r.clientName ?? null,
      phase: r.p.phase as Phase,
    }));
}
