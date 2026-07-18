import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import {
  annotations,
  approvals,
  comments,
  deliverables,
  projects,
  versions,
} from "../db/schema";
import type {
  Annotation,
  AnnotationStatus,
  Decision,
  Deliverable,
  DeliverableStatus,
  Phase,
  Project,
  ProjectGraph,
} from "./types";

export async function listProjects(): Promise<Project[]> {
  "use server";
  const db = await getDb();
  const rows = await db.select().from(projects).orderBy(desc(projects.createdAt));
  const counts = await db.select({ projectId: deliverables.projectId, id: deliverables.id }).from(deliverables);
  return rows.map(r => ({
    ...(r as Project),
    phase: r.phase as Phase,
    deliverableCount: counts.filter(c => c.projectId === r.id).length,
  }));
}

export async function createProject(id: string, name: string, clientName: string): Promise<void> {
  "use server";
  const db = await getDb();
  await db.insert(projects).values({ id, name, clientName, createdAt: Date.now() });
}

export async function getProjectGraph(projectId: string): Promise<ProjectGraph | null> {
  "use server";
  const db = await getDb();
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) return null;

  const dRows = await db
    .select()
    .from(deliverables)
    .where(eq(deliverables.projectId, projectId))
    .orderBy(asc(deliverables.createdAt));

  const dIds = dRows.map(d => d.id);
  const vRows = dIds.length
    ? await db.select().from(versions).where(inArray(versions.deliverableId, dIds)).orderBy(asc(versions.number))
    : [];
  const aRows = dIds.length
    ? await db.select().from(annotations).where(inArray(annotations.deliverableId, dIds)).orderBy(asc(annotations.createdAt))
    : [];
  const aIds = aRows.map(a => a.id);
  const cRows = aIds.length
    ? await db.select().from(comments).where(inArray(comments.annotationId, aIds)).orderBy(asc(comments.createdAt))
    : [];
  const apRows = dIds.length
    ? await db.select().from(approvals).where(inArray(approvals.deliverableId, dIds)).orderBy(asc(approvals.createdAt))
    : [];

  const graph: ProjectGraph = {
    project: { ...(project as Project), phase: project.phase as Phase },
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
  const db = await getDb();
  await db.insert(deliverables).values({ id, projectId, name, spec, posX, posY, createdAt: Date.now() });
}

export async function moveDeliverable(id: string, posX: number, posY: number): Promise<void> {
  "use server";
  const db = await getDb();
  await db.update(deliverables).set({ posX, posY }).where(eq(deliverables.id, id));
}

export async function renameDeliverable(id: string, name: string): Promise<void> {
  "use server";
  const db = await getDb();
  await db.update(deliverables).set({ name }).where(eq(deliverables.id, id));
}

export async function createAnnotation(
  id: string,
  deliverableId: string,
  versionId: string,
  x: number,
  y: number
): Promise<void> {
  "use server";
  const db = await getDb();
  await db.insert(annotations).values({ id, deliverableId, versionId, x, y, createdAt: Date.now() });
}

export async function deleteAnnotation(id: string): Promise<void> {
  "use server";
  const db = await getDb();
  await db.delete(comments).where(eq(comments.annotationId, id));
  await db.delete(annotations).where(eq(annotations.id, id));
}

export async function addComment(
  id: string,
  annotationId: string,
  authorName: string,
  body: string
): Promise<void> {
  "use server";
  const db = await getDb();
  await db.insert(comments).values({ id, annotationId, authorName, body, createdAt: Date.now() });
}

export async function resolveAnnotation(id: string, status: AnnotationStatus): Promise<void> {
  "use server";
  const db = await getDb();
  await db.update(annotations).set({ status }).where(eq(annotations.id, id));
}

/**
 * Records an approval decision for a version and rolls the result up to the
 * deliverable status. Approve is rejected server-side while open threads exist.
 */
export async function decideVersion(
  id: string,
  deliverableId: string,
  versionId: string,
  decision: Decision,
  approverName: string,
  note = ""
): Promise<{ ok: boolean; error?: string }> {
  "use server";
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
    approverName,
    note,
    createdAt: Date.now(),
  });
  await db
    .update(deliverables)
    .set({ status: decision === "approved" ? "approved" : "revisions_requested" })
    .where(eq(deliverables.id, deliverableId));
  return { ok: true };
}
