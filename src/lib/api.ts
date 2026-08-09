import { and, asc, count, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { getDb } from "../db";
import {
  aiConversations,
  aiMessages,
  aiUsage,
  annotations,
  approvals,
  canvasObjects,
  entities,
  comments,
  deliverables,
  deliverableGroups,
  deliverableTags,
  history,
  invitationGrants,
  libraryFiles,
  libraryFolders,
  personalPositions,
  projects,
  projectShares,
  projectTags,
  tags,
  taskLinks,
  tasks,
  versions,
} from "../db/schema";
import type {
  Annotation,
  AnnotationStatus,
  CanvasObject,
  Decision,
  Deliverable,
  DeliverableMetadata,
  DeliverableStatus,
  HistoryEntry,
  MetadataField,
  MetadataLink,
  NoteColor,
  PersonalPosition,
  Project,
  ProjectGraph,
  TagColor,
} from "./types";
import {
  canSetStatus,
  PROJECT_STATUS_META,
  type ProjectStatus,
  type TaskCounts,
} from "./project-status";
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
import {
  createProjectFolder,
  setDeliverableMirrorsDeleted,
  setMirrorDeleted,
} from "./library";
import {
  AnnotationStatusSchema,
  CommentBody,
  DecisionSchema,
  FiniteNumber,
  Id,
  LongText,
  Norm01,
  NoteColorSchema,
  PersonalPositionKindSchema,
  ProjectStatusSchema,
  ShortText,
  TagList,
  parseOrThrow,
} from "./validate";

export async function listProjects(entityId?: string | null): Promise<Project[]> {
  "use server";
  const session = await requireSession();
  const orgId = session.activeOrganizationId;
  if (!orgId) return [];
  const { role } = await requireMember(orgId);
  const db = await getDb();

  let rows =
    role === "guest"
      ? await db
          .select({ p: projects, entityName: entities.name })
          .from(projects)
          .leftJoin(entities, eq(entities.id, projects.entityId))
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
          .select({ p: projects, entityName: entities.name })
          .from(projects)
          .leftJoin(entities, eq(entities.id, projects.entityId))
          .where(and(eq(projects.organizationId, orgId), isNull(projects.archivedAt)))
          .orderBy(desc(projects.createdAt));

  if (entityId) {
    const checked = parseOrThrow(Id, entityId);
    rows = rows.filter((r) => r.p.entityId === checked);
  }

  const ids = rows.map((r) => r.p.id);
  const counts = ids.length
    ? await db
        .select({
          projectId: deliverables.projectId,
          id: deliverables.id,
          status: deliverables.status,
        })
        .from(deliverables)
        .where(and(inArray(deliverables.projectId, ids), isNull(deliverables.deletedAt)))
    : [];
  // Cover = the most recently uploaded image across the project's deliverables.
  // Ordered newest-first so the first row per project is that project's cover.
  const coverRows = ids.length
    ? await db
        .select({
          projectId: deliverables.projectId,
          fileName: versions.fileName,
        })
        .from(versions)
        .innerJoin(deliverables, eq(deliverables.id, versions.deliverableId))
        .where(and(inArray(deliverables.projectId, ids), isNull(deliverables.deletedAt)))
        .orderBy(desc(versions.createdAt))
    : [];
  const tagRows = ids.length
    ? await db
        .select({
          projectId: projectTags.projectId,
          id: tags.id,
          name: tags.name,
          color: tags.color,
        })
        .from(projectTags)
        .innerJoin(tags, eq(tags.id, projectTags.tagId))
        .where(inArray(projectTags.projectId, ids))
    : [];
  // Per-project task counts by status — drives the card's status pill + its gate.
  const taskRows = ids.length
    ? await db
        .select({ projectId: tasks.projectId, status: tasks.status })
        .from(tasks)
        .where(and(inArray(tasks.projectId, ids), isNull(tasks.deletedAt)))
    : [];
  return rows.map((r) => {
    const projectDeliverables = counts.filter((c) => c.projectId === r.p.id);
    const projectTaskRows = taskRows.filter((t) => t.projectId === r.p.id);
    const taskCounts: TaskCounts = {
      todo: projectTaskRows.filter((t) => t.status === "todo").length,
      in_progress: projectTaskRows.filter((t) => t.status === "in_progress").length,
      done: projectTaskRows.filter((t) => t.status === "done").length,
    };
    return {
      ...(r.p as unknown as Project),
      entityName: r.entityName ?? null,
      status: r.p.status as ProjectStatus,
      deliverableCount: projectDeliverables.length,
      cover: coverRows.find((c) => c.projectId === r.p.id)?.fileName ?? null,
      statusCounts: {
        in_review: projectDeliverables.filter((c) => c.status === "in_review").length,
        revisions_requested: projectDeliverables.filter(
          (c) => c.status === "revisions_requested",
        ).length,
        approved: projectDeliverables.filter((c) => c.status === "approved").length,
      },
      taskCounts,
      tags: tagRows
        .filter((t) => t.projectId === r.p.id)
        .map((t) => ({ id: t.id, name: t.name, color: t.color as TagColor })),
    };
  });
}

export async function createProject(
  id: string,
  name: string,
  entityId: string | null,
): Promise<void> {
  "use server";
  id = parseOrThrow(Id, id);
  name = parseOrThrow(ShortText, name);
  entityId = entityId ? parseOrThrow(Id, entityId) : null;
  const session = await requireSession();
  const orgId = session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");
  const { role } = await requireMember(orgId);
  authorize(role, "project", "create");
  const db = await getDb();
  if (entityId) {
    const [c] = await db
      .select({ id: entities.id })
      .from(entities)
      .where(and(eq(entities.id, entityId), eq(entities.organizationId, orgId)));
    if (!c) throw new Error("Unknown entity");
  }
  await db.insert(projects).values({
    id,
    organizationId: orgId,
    name,
    entityId,
    createdBy: session.userId,
    createdAt: Date.now(),
  });
  await createProjectFolder(db, { id, organizationId: orgId, name });
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
  projectId = parseOrThrow(Id, projectId);
  const { session, role, project } = await requireProjectAccess(projectId);
  // archived projects are only reachable by admins (to review before restore)
  if (project.archivedAt && role !== "admin" && role !== "owner") return null;
  const db = await getDb();

  let entityName: string | null = null;
  if (project.entityId) {
    const [c] = await db
      .select({ name: entities.name })
      .from(entities)
      .where(eq(entities.id, project.entityId));
    entityName = c?.name ?? null;
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

  const groupRows = await db
    .select()
    .from(deliverableGroups)
    .where(eq(deliverableGroups.projectId, projectId));
  const groupLabels = new Map(groupRows.map(g => [g.id, g.label]));

  const pTagRows = await db
    .select({ id: tags.id, name: tags.name, color: tags.color })
    .from(projectTags)
    .innerJoin(tags, eq(tags.id, projectTags.tagId))
    .where(eq(projectTags.projectId, projectId));
  const dTagRows = dIds.length
    ? await db
        .select({
          deliverableId: deliverableTags.deliverableId,
          id: tags.id,
          name: tags.name,
          color: tags.color,
        })
        .from(deliverableTags)
        .innerJoin(tags, eq(tags.id, deliverableTags.tagId))
        .where(inArray(deliverableTags.deliverableId, dIds))
    : [];

  const coRows = await db
    .select()
    .from(canvasObjects)
    .where(and(eq(canvasObjects.projectId, projectId), isNull(canvasObjects.deletedAt)))
    .orderBy(asc(canvasObjects.createdAt));

  const positionSubjectIds = [...dIds, ...coRows.map(o => o.id)];
  const ppRows = positionSubjectIds.length
    ? await db
        .select()
        .from(personalPositions)
        .where(and(eq(personalPositions.userId, session.userId), inArray(personalPositions.subjectId, positionSubjectIds)))
    : [];

  const graph: ProjectGraph = {
    project: {
      ...(project as unknown as Project),
      entityName,
      status: project.status as ProjectStatus,
      tags: pTagRows.map(t => ({ id: t.id, name: t.name, color: t.color as TagColor })),
    },
    viewer: { userId: session.userId, name: session.name, role },
    groups: groupRows.map(g => ({
      id: g.id,
      label: g.label,
      parentGroupId: g.parentGroupId ?? null,
      posX: g.posX ?? null,
      posY: g.posY ?? null,
      w: g.w ?? null,
      h: g.h ?? null,
    })),
    canvasObjects: coRows.map(o => ({
      ...(o as unknown as CanvasObject),
      tags: parseTags(o.tags),
    })),
    personalPositions: ppRows.map(p => ({
      kind: p.kind as PersonalPosition["kind"],
      subjectId: p.subjectId,
      posX: p.posX,
      posY: p.posY,
    })),
    deliverables: dRows.map(d => ({
      ...(d as unknown as Deliverable),
      status: d.status as DeliverableStatus,
      metadata: parseMetadata((d as { metadata?: string }).metadata),
      groupLabel: d.groupId ? (groupLabels.get(d.groupId) ?? null) : null,
      tags: dTagRows
        .filter(t => t.deliverableId === d.id)
        .map(t => ({ id: t.id, name: t.name, color: t.color as TagColor })),
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
  spec = "",
  groupId: string | null = null,
): Promise<void> {
  "use server";
  id = parseOrThrow(Id, id);
  projectId = parseOrThrow(Id, projectId);
  name = parseOrThrow(ShortText, name);
  posX = parseOrThrow(FiniteNumber, posX);
  posY = parseOrThrow(FiniteNumber, posY);
  spec = parseOrThrow(LongText, spec);
  groupId = groupId ? parseOrThrow(Id, groupId) : null;
  const { session } = await requireProjectAccess(projectId, { resource: "deliverable", action: "create" });
  const db = await getDb();
  if (groupId) {
    const [g] = await db
      .select({ projectId: deliverableGroups.projectId })
      .from(deliverableGroups)
      .where(eq(deliverableGroups.id, groupId));
    if (!g || g.projectId !== projectId) throw new Error("Unknown group");
  }
  await db.insert(deliverables).values({ id, projectId, name, spec, posX, posY, groupId, createdAt: Date.now() });
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
  id = parseOrThrow(Id, id);
  posX = parseOrThrow(FiniteNumber, posX);
  posY = parseOrThrow(FiniteNumber, posY);
  const projectId = await resolveDeliverableProject(id);
  await requireProjectAccess(projectId, { resource: "deliverable", action: "move" });
  const db = await getDb();
  await db.update(deliverables).set({ posX, posY }).where(eq(deliverables.id, id));
}

export async function renameDeliverable(id: string, name: string): Promise<void> {
  "use server";
  id = parseOrThrow(Id, id);
  name = parseOrThrow(ShortText, name);
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

/**
 * Duplicate a deliverable: a fresh deliverable (name + " copy") carrying the
 * source's spec, tags, group, and its latest version (same file on disk — the
 * version row references the shared fileName, no copy). Annotations/approvals are
 * NOT copied (the duplicate starts a clean draft). Ids are client-generated so
 * the optimistic copy matches the persisted row.
 */
export async function duplicateDeliverable(
  newDeliverableId: string,
  sourceId: string,
  newVersionId: string | null,
  dx: number,
  dy: number,
): Promise<void> {
  "use server";
  newDeliverableId = parseOrThrow(Id, newDeliverableId);
  sourceId = parseOrThrow(Id, sourceId);
  newVersionId = newVersionId ? parseOrThrow(Id, newVersionId) : null;
  dx = parseOrThrow(FiniteNumber, dx);
  dy = parseOrThrow(FiniteNumber, dy);
  const projectId = await resolveDeliverableProject(sourceId);
  const { session } = await requireProjectAccess(projectId, { resource: "deliverable", action: "create" });
  const db = await getDb();
  const [src] = await db.select().from(deliverables).where(eq(deliverables.id, sourceId));
  if (!src || src.deletedAt) throw new Error("Not found");
  await db.insert(deliverables).values({
    id: newDeliverableId,
    projectId,
    name: `${src.name} copy`,
    spec: src.spec,
    posX: src.posX + dx,
    posY: src.posY + dy,
    groupId: src.groupId,
    metadata: src.metadata,
    createdAt: Date.now(),
  });
  // copy the tag set
  const srcTags = await db
    .select({ tagId: deliverableTags.tagId })
    .from(deliverableTags)
    .where(eq(deliverableTags.deliverableId, sourceId));
  for (const t of srcTags) {
    await db.insert(deliverableTags).values({
      id: crypto.randomUUID(),
      deliverableId: newDeliverableId,
      tagId: t.tagId,
    });
  }
  // copy the latest live version (shares the file on disk)
  if (newVersionId) {
    const [latest] = await db
      .select()
      .from(versions)
      .where(and(eq(versions.deliverableId, sourceId), isNull(versions.deletedAt)))
      .orderBy(desc(versions.number))
      .limit(1);
    if (latest) {
      await db.insert(versions).values({
        id: newVersionId,
        deliverableId: newDeliverableId,
        number: 1,
        fileName: latest.fileName,
        width: latest.width,
        height: latest.height,
        createdAt: Date.now(),
      });
    }
  }
  await recordHistory(db, {
    projectId,
    deliverableId: newDeliverableId,
    subjectId: newDeliverableId,
    userId: session.userId,
    actorName: session.name,
    type: "deliverable_created",
    detail: `duplicated “${src.name}”`,
  });
}

/**
 * Group deliverables as size/format variants under one label. Always creates
 * a fresh group for the selection, overwriting any prior groupId on the
 * given deliverables (simplest v1 semantics — no merge-with-existing-group).
 * When `parentGroupId` is given the new group is nested under it (a sub-group
 * created from cards that already share a parent group).
 */
export async function groupDeliverables(
  groupId: string,
  deliverableIds: string[],
  label: string,
  parentGroupId: string | null = null,
): Promise<string> {
  "use server";
  if (deliverableIds.length < 1) throw new Error("Select at least one deliverable to group");
  groupId = parseOrThrow(Id, groupId);
  const ids = deliverableIds.map(id => parseOrThrow(Id, id));
  label = parseOrThrow(ShortText, label);
  parentGroupId = parentGroupId ? parseOrThrow(Id, parentGroupId) : null;
  const projectId = await resolveDeliverableProject(ids[0]);
  const { session } = await requireProjectAccess(projectId, { resource: "deliverable", action: "update" });
  const db = await getDb();
  if (parentGroupId) {
    const [p] = await db
      .select({ projectId: deliverableGroups.projectId })
      .from(deliverableGroups)
      .where(eq(deliverableGroups.id, parentGroupId));
    if (!p || p.projectId !== projectId) throw new Error("Unknown parent group");
  }
  await db.insert(deliverableGroups).values({ id: groupId, projectId, label, parentGroupId, createdAt: Date.now() });
  await db.update(deliverables).set({ groupId }).where(inArray(deliverables.id, ids));
  await recordHistory(db, {
    projectId,
    userId: session.userId,
    actorName: session.name,
    type: "deliverable_renamed",
    detail: `grouped ${ids.length} deliverables as “${label}”`,
  });
  return groupId;
}

/**
 * Create an empty group *container* with its own frame (position + size). Unlike
 * groupDeliverables this has no members — its outline is drawn from the stored
 * frame so it's visible and draggable before anything is dropped in. Client-
 * generated id (for undo/redo symmetry).
 */
export async function createGroup(
  id: string,
  projectId: string,
  label: string,
  posX: number,
  posY: number,
  w: number,
  h: number,
  parentGroupId: string | null = null,
): Promise<void> {
  "use server";
  id = parseOrThrow(Id, id);
  projectId = parseOrThrow(Id, projectId);
  label = parseOrThrow(ShortText, label);
  posX = parseOrThrow(FiniteNumber, posX);
  posY = parseOrThrow(FiniteNumber, posY);
  w = parseOrThrow(FiniteNumber, w);
  h = parseOrThrow(FiniteNumber, h);
  parentGroupId = parentGroupId ? parseOrThrow(Id, parentGroupId) : null;
  const { session } = await requireProjectAccess(projectId, { resource: "deliverable", action: "update" });
  const db = await getDb();
  if (parentGroupId) {
    const [p] = await db
      .select({ projectId: deliverableGroups.projectId })
      .from(deliverableGroups)
      .where(eq(deliverableGroups.id, parentGroupId));
    if (!p || p.projectId !== projectId) throw new Error("Unknown parent group");
  }
  await db.insert(deliverableGroups).values({ id, projectId, label, parentGroupId, posX, posY, w, h, createdAt: Date.now() });
  await recordHistory(db, {
    projectId,
    userId: session.userId,
    actorName: session.name,
    type: "deliverable_renamed",
    detail: `created group “${label}”`,
  });
}

/** Persist a group container's frame (move / resize). */
export async function setGroupFrame(
  groupId: string,
  posX: number,
  posY: number,
  w: number,
  h: number,
): Promise<void> {
  "use server";
  groupId = parseOrThrow(Id, groupId);
  posX = parseOrThrow(FiniteNumber, posX);
  posY = parseOrThrow(FiniteNumber, posY);
  w = parseOrThrow(FiniteNumber, w);
  h = parseOrThrow(FiniteNumber, h);
  const db = await getDb();
  const [g] = await db
    .select({ projectId: deliverableGroups.projectId })
    .from(deliverableGroups)
    .where(eq(deliverableGroups.id, groupId));
  if (!g) throw new Error("Not found");
  await requireProjectAccess(g.projectId, { resource: "deliverable", action: "update" });
  await db.update(deliverableGroups).set({ posX, posY, w, h }).where(eq(deliverableGroups.id, groupId));
}

export async function ungroupDeliverable(id: string): Promise<void> {
  "use server";
  id = parseOrThrow(Id, id);
  const projectId = await resolveDeliverableProject(id);
  await requireProjectAccess(projectId, { resource: "deliverable", action: "update" });
  const db = await getDb();
  const [d] = await db.select({ groupId: deliverables.groupId }).from(deliverables).where(eq(deliverables.id, id));
  if (!d?.groupId) return;
  const groupId = d.groupId;
  await db.update(deliverables).set({ groupId: null }).where(eq(deliverables.id, id));
  const remaining = await db.select({ id: deliverables.id }).from(deliverables).where(eq(deliverables.groupId, groupId));
  if (remaining.length === 0) {
    // Only auto-delete derived groups. A container with its own frame persists
    // as an empty group you can keep dropping items into.
    const [g] = await db
      .select({ posX: deliverableGroups.posX })
      .from(deliverableGroups)
      .where(eq(deliverableGroups.id, groupId));
    if (g && g.posX === null) {
      await db.delete(deliverableGroups).where(eq(deliverableGroups.id, groupId));
    }
  }
}

/** Add one ungrouped deliverable directly to an existing group. */
export async function addDeliverableToGroup(deliverableId: string, groupId: string): Promise<void> {
  "use server";
  deliverableId = parseOrThrow(Id, deliverableId);
  groupId = parseOrThrow(Id, groupId);
  const projectId = await resolveDeliverableProject(deliverableId);
  const { session } = await requireProjectAccess(projectId, { resource: "deliverable", action: "update" });
  const db = await getDb();
  const [g] = await db
    .select({ projectId: deliverableGroups.projectId, label: deliverableGroups.label })
    .from(deliverableGroups)
    .where(eq(deliverableGroups.id, groupId));
  if (!g || g.projectId !== projectId) throw new Error("Unknown group");
  await db.update(deliverables).set({ groupId }).where(eq(deliverables.id, deliverableId));
  await recordHistory(db, {
    projectId,
    deliverableId,
    subjectId: deliverableId,
    userId: session.userId,
    actorName: session.name,
    type: "deliverable_renamed",
    detail: `added to group “${g.label}”`,
  });
}

export async function renameGroup(groupId: string, label: string): Promise<void> {
  "use server";
  groupId = parseOrThrow(Id, groupId);
  label = parseOrThrow(ShortText, label);
  const [g] = await (await getDb()).select({ projectId: deliverableGroups.projectId }).from(deliverableGroups).where(eq(deliverableGroups.id, groupId));
  if (!g) throw new Error("Not found");
  await requireProjectAccess(g.projectId, { resource: "deliverable", action: "update" });
  const db = await getDb();
  await db.update(deliverableGroups).set({ label }).where(eq(deliverableGroups.id, groupId));
}

/** Nest existing groups under a new labeled parent group. */
export async function groupGroups(parentId: string, childGroupIds: string[], label: string): Promise<string> {
  "use server";
  if (childGroupIds.length < 2) throw new Error("Select at least two groups to group");
  parentId = parseOrThrow(Id, parentId);
  const ids = childGroupIds.map(id => parseOrThrow(Id, id));
  label = parseOrThrow(ShortText, label);
  const db = await getDb();
  const children = await db
    .select({ id: deliverableGroups.id, projectId: deliverableGroups.projectId })
    .from(deliverableGroups)
    .where(inArray(deliverableGroups.id, ids));
  if (children.length !== ids.length) throw new Error("Unknown group");
  const projectId = children[0].projectId;
  if (children.some(c => c.projectId !== projectId)) throw new Error("Groups must belong to one project");
  const { session } = await requireProjectAccess(projectId, { resource: "deliverable", action: "update" });
  await db.insert(deliverableGroups).values({ id: parentId, projectId, label, createdAt: Date.now() });
  await db.update(deliverableGroups).set({ parentGroupId: parentId }).where(inArray(deliverableGroups.id, ids));
  await recordHistory(db, {
    projectId,
    userId: session.userId,
    actorName: session.name,
    type: "deliverable_renamed",
    detail: `grouped ${ids.length} groups as “${label}”`,
  });
  return parentId;
}

/**
 * Reparent an existing group under another group, or to the top level when
 * `parentGroupId` is null. Powers drag-a-group-into-a-group and the nesting
 * menu. Guards against cycles — a group can't become its own descendant.
 */
export async function setGroupParent(
  childGroupId: string,
  parentGroupId: string | null,
): Promise<void> {
  "use server";
  childGroupId = parseOrThrow(Id, childGroupId);
  parentGroupId = parentGroupId ? parseOrThrow(Id, parentGroupId) : null;
  if (childGroupId === parentGroupId) throw new Error("A group can't contain itself");
  const db = await getDb();
  const [child] = await db
    .select({ projectId: deliverableGroups.projectId })
    .from(deliverableGroups)
    .where(eq(deliverableGroups.id, childGroupId));
  if (!child) throw new Error("Unknown group");
  const { session } = await requireProjectAccess(child.projectId, { resource: "deliverable", action: "update" });
  if (parentGroupId) {
    const all = await db
      .select({ id: deliverableGroups.id, parentGroupId: deliverableGroups.parentGroupId })
      .from(deliverableGroups)
      .where(eq(deliverableGroups.projectId, child.projectId));
    const byId = new Map(all.map(g => [g.id, g.parentGroupId as string | null]));
    if (!byId.has(parentGroupId)) throw new Error("Unknown parent group");
    // walk up from the proposed parent; reaching the child means a cycle
    let cur: string | null = parentGroupId;
    for (let i = 0; i < 64 && cur; i++) {
      if (cur === childGroupId) throw new Error("That would nest a group inside itself");
      cur = byId.get(cur) ?? null;
    }
  }
  await db.update(deliverableGroups).set({ parentGroupId }).where(eq(deliverableGroups.id, childGroupId));
  await recordHistory(db, {
    projectId: child.projectId,
    userId: session.userId,
    actorName: session.name,
    type: "deliverable_renamed",
    detail: parentGroupId ? "nested a group" : "moved a group to the top level",
  });
}

/**
 * Dissolve one group level: a leaf group releases its member deliverables,
 * a parent group releases its child groups. The row itself is deleted.
 */
export async function dissolveGroup(groupId: string): Promise<void> {
  "use server";
  groupId = parseOrThrow(Id, groupId);
  const db = await getDb();
  const [g] = await db
    .select({ projectId: deliverableGroups.projectId })
    .from(deliverableGroups)
    .where(eq(deliverableGroups.id, groupId));
  if (!g) return;
  const { session } = await requireProjectAccess(g.projectId, { resource: "deliverable", action: "update" });
  await db.update(deliverables).set({ groupId: null }).where(eq(deliverables.groupId, groupId));
  await db
    .update(deliverableGroups)
    .set({ parentGroupId: null })
    .where(eq(deliverableGroups.parentGroupId, groupId));
  await db.delete(deliverableGroups).where(eq(deliverableGroups.id, groupId));
  await recordHistory(db, {
    projectId: g.projectId,
    userId: session.userId,
    actorName: session.name,
    type: "deliverable_renamed",
    detail: "ungrouped a deliverable group",
  });
}

/**
 * Delete a group row outright (reparenting child groups up, releasing any live
 * members). Unlike dissolveGroup this is used after members are already deleted
 * so the empty group frame doesn't linger. Framed empty containers included.
 */
export async function deleteGroup(groupId: string): Promise<void> {
  "use server";
  groupId = parseOrThrow(Id, groupId);
  const db = await getDb();
  const [g] = await db
    .select({ projectId: deliverableGroups.projectId })
    .from(deliverableGroups)
    .where(eq(deliverableGroups.id, groupId));
  if (!g) return;
  await requireProjectAccess(g.projectId, { resource: "deliverable", action: "update" });
  await db.update(deliverables).set({ groupId: null }).where(eq(deliverables.groupId, groupId));
  await db
    .update(deliverableGroups)
    .set({ parentGroupId: null })
    .where(eq(deliverableGroups.parentGroupId, groupId));
  await db.delete(deliverableGroups).where(eq(deliverableGroups.id, groupId));
}

// ---- canvas objects (sticky notes) ----------------------------------------
// Board-only working notes: never mirrored into the library.

/** `canvas_objects.tags` is a JSON array in a text column — corrupt or
 * missing data degrades to no tags rather than failing the whole graph load. */
function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

/** Parse the deliverable.metadata JSON blob into a well-formed shape. */
function parseMetadata(raw: string | null | undefined): DeliverableMetadata {
  try {
    const p = raw ? JSON.parse(raw) : {};
    const links = Array.isArray(p.links)
      ? p.links
          .filter((l: unknown): l is MetadataLink => !!l && typeof (l as MetadataLink).url === "string")
          .map((l: MetadataLink) => ({ label: String(l.label ?? ""), url: String(l.url) }))
      : [];
    const fields = Array.isArray(p.fields)
      ? p.fields
          .filter((f: unknown): f is MetadataField => !!f && typeof (f as MetadataField).key === "string")
          .map((f: MetadataField) => ({ key: String(f.key), value: String(f.value ?? "") }))
      : [];
    return { links, fields };
  } catch {
    return { links: [], fields: [] };
  }
}

/** Replace a deliverable's custom metadata (reference links + key/value fields). */
export async function setDeliverableMetadata(
  id: string,
  metadata: DeliverableMetadata,
): Promise<void> {
  "use server";
  id = parseOrThrow(Id, id);
  const projectId = await resolveDeliverableProject(id);
  await requireProjectAccess(projectId, { resource: "deliverable", action: "update" });
  const clean = parseMetadata(JSON.stringify(metadata ?? {}));
  const db = await getDb();
  await db.update(deliverables).set({ metadata: JSON.stringify(clean) }).where(eq(deliverables.id, id));
}

export async function createCanvasObject(
  id: string,
  projectId: string,
  posX: number,
  posY: number,
  content = "",
  color = "yellow",
): Promise<void> {
  "use server";
  id = parseOrThrow(Id, id);
  projectId = parseOrThrow(Id, projectId);
  posX = parseOrThrow(FiniteNumber, posX);
  posY = parseOrThrow(FiniteNumber, posY);
  content = parseOrThrow(LongText, content);
  color = parseOrThrow(NoteColorSchema, color);
  const { session } = await requireProjectAccess(projectId, {
    resource: "canvasObject",
    action: "create",
  });
  const db = await getDb();
  await db.insert(canvasObjects).values({
    id,
    projectId,
    kind: "note",
    content,
    color,
    posX,
    posY,
    createdBy: session.userId,
    createdByName: session.name,
    createdAt: Date.now(),
  });
}

async function resolveCanvasObjectProject(id: string): Promise<string> {
  const db = await getDb();
  const [o] = await db
    .select({ projectId: canvasObjects.projectId })
    .from(canvasObjects)
    .where(eq(canvasObjects.id, id));
  if (!o) throw new Error("Not found");
  return o.projectId;
}

export async function updateCanvasObject(
  id: string,
  patch: { content?: string; color?: string; tags?: string[] },
): Promise<void> {
  "use server";
  id = parseOrThrow(Id, id);
  const set: { content?: string; color?: string; tags?: string } = {};
  if (patch.content !== undefined) set.content = parseOrThrow(LongText, patch.content);
  if (patch.color !== undefined) set.color = parseOrThrow(NoteColorSchema, patch.color);
  if (patch.tags !== undefined) set.tags = JSON.stringify(parseOrThrow(TagList, patch.tags));
  if (Object.keys(set).length === 0) return;
  const projectId = await resolveCanvasObjectProject(id);
  await requireProjectAccess(projectId, { resource: "canvasObject", action: "update" });
  const db = await getDb();
  await db.update(canvasObjects).set(set).where(eq(canvasObjects.id, id));
}

export async function moveCanvasObject(id: string, posX: number, posY: number): Promise<void> {
  "use server";
  id = parseOrThrow(Id, id);
  posX = parseOrThrow(FiniteNumber, posX);
  posY = parseOrThrow(FiniteNumber, posY);
  const projectId = await resolveCanvasObjectProject(id);
  await requireProjectAccess(projectId, { resource: "canvasObject", action: "move" });
  const db = await getDb();
  await db.update(canvasObjects).set({ posX, posY }).where(eq(canvasObjects.id, id));
}

export async function deleteCanvasObject(id: string): Promise<void> {
  "use server";
  id = parseOrThrow(Id, id);
  const projectId = await resolveCanvasObjectProject(id);
  const { session } = await requireProjectAccess(projectId, {
    resource: "canvasObject",
    action: "delete",
  });
  const db = await getDb();
  await db
    .update(canvasObjects)
    .set({ deletedAt: Date.now(), deletedBy: session.userId })
    .where(eq(canvasObjects.id, id));
}

// ---- personal (per-viewer) canvas layout -----------------------------------
// The "sync" position lives on deliverables.pos_x/y or canvas_objects.pos_x/y
// directly. This is the parallel "personal mode" layer: one row per
// (viewer, subject), upserted, never touching the shared columns.

/** Upsert the caller's personal-layout position for one deliverable or note. */
export async function setPersonalPosition(
  kind: "deliverable" | "note",
  subjectId: string,
  posX: number,
  posY: number,
): Promise<void> {
  "use server";
  kind = parseOrThrow(PersonalPositionKindSchema, kind);
  subjectId = parseOrThrow(Id, subjectId);
  posX = parseOrThrow(FiniteNumber, posX);
  posY = parseOrThrow(FiniteNumber, posY);
  const session = await requireSession();
  const projectId = kind === "deliverable"
    ? await resolveDeliverableProject(subjectId)
    : await resolveCanvasObjectProject(subjectId);
  await requireProjectAccess(projectId, {
    resource: kind === "deliverable" ? "deliverable" : "canvasObject",
    action: "move",
  });
  const db = await getDb();
  const [existing] = await db
    .select({ id: personalPositions.id })
    .from(personalPositions)
    .where(and(
      eq(personalPositions.userId, session.userId),
      eq(personalPositions.kind, kind),
      eq(personalPositions.subjectId, subjectId),
    ));
  if (existing) {
    await db
      .update(personalPositions)
      .set({ posX, posY, updatedAt: Date.now() })
      .where(eq(personalPositions.id, existing.id));
  } else {
    await db.insert(personalPositions).values({
      id: crypto.randomUUID(),
      userId: session.userId,
      kind,
      subjectId,
      posX,
      posY,
      updatedAt: Date.now(),
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
  id = parseOrThrow(Id, id);
  deliverableId = parseOrThrow(Id, deliverableId);
  versionId = parseOrThrow(Id, versionId);
  x = parseOrThrow(Norm01, x);
  y = parseOrThrow(Norm01, y);
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
  id = parseOrThrow(Id, id);
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
  id = parseOrThrow(Id, id);
  annotationId = parseOrThrow(Id, annotationId);
  body = parseOrThrow(CommentBody, body);
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
  id = parseOrThrow(Id, id);
  status = parseOrThrow(AnnotationStatusSchema, status);
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
  id = parseOrThrow(Id, id);
  deliverableId = parseOrThrow(Id, deliverableId);
  versionId = parseOrThrow(Id, versionId);
  decision = parseOrThrow(DecisionSchema, decision);
  note = parseOrThrow(LongText, note);
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
  versionId = parseOrThrow(Id, versionId);
  const db = await getDb();
  const [v] = await db.select().from(versions).where(eq(versions.id, versionId));
  if (!v || v.deletedAt) throw new Error("Not found");
  const projectId = await resolveDeliverableProject(v.deliverableId);
  const { session } = await requireProjectAccess(projectId, {
    resource: "version",
    action: "delete",
  });
  const deletedAt = Date.now();
  await db
    .update(versions)
    .set({ deletedAt, deletedBy: session.userId })
    .where(eq(versions.id, versionId));
  await setMirrorDeleted(db, versionId, deletedAt, session.userId);
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
  versionId = parseOrThrow(Id, versionId);
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
  await setMirrorDeleted(db, versionId, null, null);
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
  id = parseOrThrow(Id, id);
  const projectId = await resolveDeliverableProject(id);
  const { session } = await requireProjectAccess(projectId, {
    resource: "deliverable",
    action: "delete",
  });
  const db = await getDb();
  const [d] = await db.select().from(deliverables).where(eq(deliverables.id, id));
  if (!d || d.deletedAt) throw new Error("Not found");
  const deletedAt = Date.now();
  await db
    .update(deliverables)
    .set({ deletedAt, deletedBy: session.userId })
    .where(eq(deliverables.id, id));
  await setDeliverableMirrorsDeleted(db, id, deletedAt, session.userId);
  // Prune a now-empty derived group (no live members, no own frame) so it stops
  // lingering in the "Add to group" lists. Framed containers are kept.
  if (d.groupId) {
    const remaining = await db
      .select({ id: deliverables.id })
      .from(deliverables)
      .where(and(eq(deliverables.groupId, d.groupId), isNull(deliverables.deletedAt)));
    if (remaining.length === 0) {
      const [g] = await db
        .select({ posX: deliverableGroups.posX })
        .from(deliverableGroups)
        .where(eq(deliverableGroups.id, d.groupId));
      if (g && g.posX === null) {
        await db.delete(deliverableGroups).where(eq(deliverableGroups.id, d.groupId));
      }
    }
  }
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
  id = parseOrThrow(Id, id);
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
  await setDeliverableMirrorsDeleted(db, id, null, null);
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
  projectId = parseOrThrow(Id, projectId);
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

/**
 * Move a project to a new status (admin/owner). Gated by tasks: advancing is
 * only allowed once every task has reached the target status or beyond; moving
 * backward is always allowed, and a project with no tasks moves freely.
 */
export async function setProjectStatus(id: string, status: string): Promise<void> {
  "use server";
  id = parseOrThrow(Id, id);
  const target = parseOrThrow(ProjectStatusSchema, status) as ProjectStatus;
  const session = await requireSession();
  const db = await getDb();
  const [p] = await db.select().from(projects).where(eq(projects.id, id));
  if (!p || p.archivedAt) throw new Error("Not found");
  const { role } = await requireMember(p.organizationId);
  authorize(role, "project", "update");

  const taskRows = await db
    .select({ status: tasks.status })
    .from(tasks)
    .where(and(eq(tasks.projectId, id), isNull(tasks.deletedAt)));
  const counts: TaskCounts = {
    todo: taskRows.filter((t) => t.status === "todo").length,
    in_progress: taskRows.filter((t) => t.status === "in_progress").length,
    done: taskRows.filter((t) => t.status === "done").length,
  };
  if (!canSetStatus(p.status as ProjectStatus, target, counts)) {
    throw new Error("All tasks must reach this status first");
  }
  if (target === (p.status as ProjectStatus)) return;

  await db.update(projects).set({ status: target }).where(eq(projects.id, id));
  await recordHistory(db, {
    projectId: id,
    userId: session.userId,
    actorName: session.name,
    type: "project_status_changed",
    detail: `moved the project to ${PROJECT_STATUS_META[target].label}`,
  });
}

/** Archive a project (admin+). It leaves all lists but is restorable. */
export async function archiveProject(id: string): Promise<void> {
  "use server";
  id = parseOrThrow(Id, id);
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
  id = parseOrThrow(Id, id);
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

/**
 * Workspace-wide "to do" counts for the global nav indicator: open tasks
 * (not done, not deleted) and deliverables still needing work (not approved,
 * not deleted, in non-archived projects). Scoped to the active org.
 */
export async function openWorkloadCounts(
  entityId?: string | null,
): Promise<{ tasks: number; deliverables: number }> {
  "use server";
  const session = await requireSession();
  const orgId = session.activeOrganizationId;
  if (!orgId) return { tasks: 0, deliverables: 0 };
  await requireMember(orgId);
  const scoped = entityId ? parseOrThrow(Id, entityId) : null;
  const db = await getDb();

  // Open tasks (not done, not deleted). When an entity is selected, scope by the
  // task's project entity — mirrors listTasks, so project-less tasks (which only
  // surface under "All Entities") drop out of a specific entity's count.
  const [t] = scoped
    ? await db
        .select({ n: count() })
        .from(tasks)
        .innerJoin(projects, eq(projects.id, tasks.projectId))
        .where(
          and(
            eq(tasks.organizationId, orgId),
            ne(tasks.status, "done"),
            isNull(tasks.deletedAt),
            eq(projects.entityId, scoped),
          ),
        )
    : await db
        .select({ n: count() })
        .from(tasks)
        .where(and(eq(tasks.organizationId, orgId), ne(tasks.status, "done"), isNull(tasks.deletedAt)));

  // Deliverables still needing work (not approved), in non-archived projects,
  // scoped to the selected entity when one is active.
  const [d] = await db
    .select({ n: count() })
    .from(deliverables)
    .innerJoin(projects, eq(projects.id, deliverables.projectId))
    .where(
      and(
        eq(projects.organizationId, orgId),
        isNull(projects.archivedAt),
        isNull(deliverables.deletedAt),
        ne(deliverables.status, "approved"),
        ...(scoped ? [eq(projects.entityId, scoped)] : []),
      ),
    );

  return { tasks: Number(t?.n ?? 0), deliverables: Number(d?.n ?? 0) };
}

/** Rename a project (project:update). */
export async function renameProject(id: string, name: string): Promise<void> {
  "use server";
  id = parseOrThrow(Id, id);
  const trimmed = parseOrThrow(ShortText, name.trim());
  const db = await getDb();
  const [p] = await db.select().from(projects).where(eq(projects.id, id));
  if (!p) throw new Error("Not found");
  const { role } = await requireMember(p.organizationId);
  authorize(role, "project", "update");
  if (trimmed === p.name) return;
  await db.update(projects).set({ name: trimmed }).where(eq(projects.id, id));
}

/**
 * Permanently delete a project and everything under it (deliverables + their
 * versions/annotations/comments/approvals/tags, groups, notes, library folder +
 * files, tasks + links, project tags/shares, invitation grants, AI conversations,
 * and history). Irreversible — the UI gates this behind an explicit confirm
 * modal. Gated on project:delete (admin+).
 */
export async function deleteProject(id: string): Promise<void> {
  "use server";
  id = parseOrThrow(Id, id);
  const db = await getDb();
  const [p] = await db.select().from(projects).where(eq(projects.id, id));
  if (!p) throw new Error("Not found");
  const { role } = await requireMember(p.organizationId);
  authorize(role, "project", "delete");

  const delIds = (await db.select({ id: deliverables.id }).from(deliverables).where(eq(deliverables.projectId, id))).map(r => r.id);
  const verIds = delIds.length
    ? (await db.select({ id: versions.id }).from(versions).where(inArray(versions.deliverableId, delIds))).map(r => r.id)
    : [];
  const annIds = delIds.length
    ? (await db.select({ id: annotations.id }).from(annotations).where(inArray(annotations.deliverableId, delIds))).map(r => r.id)
    : [];
  const folderIds = (await db.select({ id: libraryFolders.id }).from(libraryFolders).where(eq(libraryFolders.projectId, id))).map(r => r.id);
  const noteIds = (await db.select({ id: canvasObjects.id }).from(canvasObjects).where(eq(canvasObjects.projectId, id))).map(r => r.id);
  const taskIds = (await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.projectId, id))).map(r => r.id);
  const convoIds = (await db.select({ id: aiConversations.id }).from(aiConversations).where(eq(aiConversations.projectId, id))).map(r => r.id);

  // children first, respecting FK direction (deepest leaves before their parents)
  if (annIds.length) await db.delete(comments).where(inArray(comments.annotationId, annIds));
  if (delIds.length) {
    await db.delete(annotations).where(inArray(annotations.deliverableId, delIds));
    await db.delete(approvals).where(inArray(approvals.deliverableId, delIds));
    await db.delete(deliverableTags).where(inArray(deliverableTags.deliverableId, delIds));
  }
  if (folderIds.length) await db.delete(libraryFiles).where(inArray(libraryFiles.folderId, folderIds));
  if (verIds.length) await db.delete(libraryFiles).where(inArray(libraryFiles.versionId, verIds));
  if (delIds.length) await db.delete(versions).where(inArray(versions.deliverableId, delIds));
  if (folderIds.length) await db.delete(libraryFolders).where(inArray(libraryFolders.id, folderIds));
  const subjectIds = [...delIds, ...noteIds];
  if (subjectIds.length) await db.delete(personalPositions).where(inArray(personalPositions.subjectId, subjectIds));
  if (taskIds.length) {
    await db.delete(taskLinks).where(inArray(taskLinks.fromTaskId, taskIds));
    await db.delete(taskLinks).where(inArray(taskLinks.toTaskId, taskIds));
  }
  await db.delete(tasks).where(eq(tasks.projectId, id));
  await db.delete(canvasObjects).where(eq(canvasObjects.projectId, id));
  await db.delete(deliverableGroups).where(eq(deliverableGroups.projectId, id));
  await db.delete(deliverables).where(eq(deliverables.projectId, id));
  await db.delete(projectTags).where(eq(projectTags.projectId, id));
  await db.delete(projectShares).where(eq(projectShares.projectId, id));
  await db.delete(invitationGrants).where(eq(invitationGrants.projectId, id));
  if (convoIds.length) {
    await db.delete(aiMessages).where(inArray(aiMessages.conversationId, convoIds));
    await db.delete(aiUsage).where(inArray(aiUsage.conversationId, convoIds));
    await db.delete(aiConversations).where(eq(aiConversations.projectId, id));
  }
  await db.delete(history).where(eq(history.projectId, id));
  await db.delete(projects).where(eq(projects.id, id));
}

/**
 * Archived projects of the active org, optionally narrowed to one entity.
 * Empty for non-admins (no error).
 */
export async function listArchivedProjects(entityId?: string | null): Promise<Project[]> {
  "use server";
  const session = await requireSession();
  const orgId = session.activeOrganizationId;
  if (!orgId) return [];
  const { role } = await requireMember(orgId);
  if (role !== "admin" && role !== "owner") return [];
  const db = await getDb();
  const rows = await db
    .select({ p: projects, entityName: entities.name })
    .from(projects)
    .leftJoin(entities, eq(entities.id, projects.entityId))
    .where(eq(projects.organizationId, orgId))
    .orderBy(desc(projects.createdAt));
  const checked = entityId ? parseOrThrow(Id, entityId) : null;
  return rows
    .filter(r => r.p.archivedAt != null)
    .filter(r => !checked || r.p.entityId === checked)
    .map(r => ({
      ...(r.p as unknown as Project),
      entityName: r.entityName ?? null,
      status: r.p.status as ProjectStatus,
    }));
}
