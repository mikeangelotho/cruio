import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import * as v from "valibot";
import { getDb } from "../db";
import { deliverables, entities, member, projects, taskLinks, tasks, user } from "../db/schema";
import { authorize, recordHistory, requireMember, requireSession } from "./guard";
import type { Task, TaskLink, TaskLinkType, TaskPriority, TaskStatus } from "./types";
import { AuthId, Id, LongText, ShortText, TaskLinkTypeSchema, parseOrThrow } from "./validate";

// Tasks are internal work items (guests never see them). Attribution comes
// from the session; ids are client-generated UUIDs so optimistic rows are
// the real rows (same pattern as the project store).

const Status = v.picklist(["todo", "in_progress", "done"]);
const Priority = v.picklist(["none", "low", "medium", "high", "urgent"]);

const TaskPatch = v.partial(
  v.object({
    title: ShortText,
    description: LongText,
    status: Status,
    priority: Priority,
    assigneeId: v.nullable(AuthId),
    dueDate: v.nullable(v.number()),
    projectId: v.nullable(Id),
    deliverableId: v.nullable(Id),
  }),
);
export type TaskPatchInput = v.InferInput<typeof TaskPatch>;

async function requireTaskContext() {
  const session = await requireSession();
  const orgId = session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");
  const { role } = await requireMember(orgId);
  return { session, orgId, role };
}

/** Validate that patch references stay inside the active org. */
async function checkPatchRefs(
  db: Awaited<ReturnType<typeof getDb>>,
  orgId: string,
  patch: v.InferOutput<typeof TaskPatch>,
) {
  if (patch.assigneeId) {
    const [m] = await db
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, orgId), eq(member.userId, patch.assigneeId)));
    if (!m) throw new Error("Assignee is not a member of this workspace");
  }
  if (patch.projectId) {
    const [p] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, patch.projectId), eq(projects.organizationId, orgId)));
    if (!p) throw new Error("Unknown project");
  }
  if (patch.deliverableId) {
    const [d] = await db
      .select({ projectId: deliverables.projectId })
      .from(deliverables)
      .where(eq(deliverables.id, patch.deliverableId));
    if (!d || (patch.projectId && d.projectId !== patch.projectId)) {
      throw new Error("Unknown deliverable");
    }
  }
}

/** Tasks of the active org, newest first; `entityId` narrows via project. */
export async function listTasks(entityId: string | null): Promise<Task[]> {
  "use server";
  const { orgId, role } = await requireTaskContext();
  authorize(role, "task", "update");
  const db = await getDb();
  const rows = await db
    .select({
      t: tasks,
      assigneeName: user.name,
      projectName: projects.name,
      entityId: projects.entityId,
    })
    .from(tasks)
    .leftJoin(user, eq(user.id, tasks.assigneeId))
    .leftJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(eq(tasks.organizationId, orgId), isNull(tasks.deletedAt)))
    .orderBy(desc(tasks.createdAt));

  let result = rows.map(r => ({
    ...(r.t as unknown as Task),
    status: r.t.status as TaskStatus,
    priority: r.t.priority as TaskPriority,
    assigneeName: r.assigneeName ?? null,
    projectName: r.projectName ?? null,
    entityId: r.entityId ?? null,
  }));
  if (entityId) {
    const checked = parseOrThrow(Id, entityId);
    result = result.filter(t => t.entityId === checked);
  }
  return result;
}

/**
 * Tasks belonging to a single project (used by the deliverable canvas to show
 * tasks in place and to derive per-deliverable stages). Org- and role-gated
 * like listTasks; guests never reach here.
 */
export async function listProjectTasks(projectId: string): Promise<Task[]> {
  "use server";
  const checkedProject = parseOrThrow(Id, projectId);
  const { orgId, role } = await requireTaskContext();
  authorize(role, "task", "update");
  const db = await getDb();
  const rows = await db
    .select({
      t: tasks,
      assigneeName: user.name,
      projectName: projects.name,
      entityId: projects.entityId,
    })
    .from(tasks)
    .leftJoin(user, eq(user.id, tasks.assigneeId))
    .leftJoin(projects, eq(projects.id, tasks.projectId))
    .where(
      and(
        eq(tasks.organizationId, orgId),
        eq(tasks.projectId, checkedProject),
        isNull(tasks.deletedAt),
      ),
    )
    .orderBy(desc(tasks.createdAt));

  return rows.map(r => ({
    ...(r.t as unknown as Task),
    status: r.t.status as TaskStatus,
    priority: r.t.priority as TaskPriority,
    assigneeName: r.assigneeName ?? null,
    projectName: r.projectName ?? null,
    entityId: r.entityId ?? null,
  }));
}

export async function createTask(
  id: string,
  title: string,
  patch: TaskPatchInput = {},
): Promise<void> {
  "use server";
  const taskId = parseOrThrow(Id, id);
  const checkedTitle = parseOrThrow(ShortText, title);
  const checkedPatch = parseOrThrow(TaskPatch, patch);
  const { session, orgId, role } = await requireTaskContext();
  authorize(role, "task", "create");
  const db = await getDb();
  await checkPatchRefs(db, orgId, checkedPatch);
  await db.insert(tasks).values({
    id: taskId,
    organizationId: orgId,
    title: checkedTitle,
    description: checkedPatch.description ?? "",
    status: checkedPatch.status ?? "todo",
    priority: checkedPatch.priority ?? "none",
    assigneeId: checkedPatch.assigneeId ?? null,
    dueDate: checkedPatch.dueDate ?? null,
    projectId: checkedPatch.projectId ?? null,
    deliverableId: checkedPatch.deliverableId ?? null,
    createdBy: session.userId,
    createdAt: Date.now(),
  });
  if (checkedPatch.projectId) {
    await recordHistory(db, {
      projectId: checkedPatch.projectId,
      deliverableId: checkedPatch.deliverableId ?? null,
      subjectId: taskId,
      userId: session.userId,
      actorName: session.name,
      type: "task_created",
      detail: `created task “${checkedTitle}”`,
    });
  }
}

export async function updateTask(id: string, patch: TaskPatchInput): Promise<void> {
  "use server";
  const taskId = parseOrThrow(Id, id);
  const checkedPatch = parseOrThrow(TaskPatch, patch);
  const { session, orgId, role } = await requireTaskContext();
  authorize(role, "task", "update");
  if (checkedPatch.assigneeId !== undefined) authorize(role, "task", "assign");
  const db = await getDb();
  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.organizationId, orgId)));
  if (!task || task.deletedAt) throw new Error("Not found");
  await checkPatchRefs(db, orgId, checkedPatch);

  const completedAt =
    checkedPatch.status === undefined
      ? task.completedAt
      : checkedPatch.status === "done"
        ? (task.completedAt ?? Date.now())
        : null;
  await db
    .update(tasks)
    .set({ ...checkedPatch, completedAt })
    .where(eq(tasks.id, taskId));

  if (checkedPatch.status === "done" && task.status !== "done" && task.projectId) {
    await recordHistory(db, {
      projectId: task.projectId,
      deliverableId: task.deliverableId,
      subjectId: taskId,
      userId: session.userId,
      actorName: session.name,
      type: "task_completed",
      detail: `completed task “${task.title}”`,
    });
  }
}

export async function deleteTask(id: string): Promise<void> {
  "use server";
  const taskId = parseOrThrow(Id, id);
  const { session, orgId, role } = await requireTaskContext();
  authorize(role, "task", "delete");
  const db = await getDb();
  const [task] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.organizationId, orgId), isNull(tasks.deletedAt)));
  if (!task) throw new Error("Not found");
  await db
    .update(tasks)
    .set({ deletedAt: Date.now(), deletedBy: session.userId })
    .where(eq(tasks.id, taskId));
}

export async function restoreTask(id: string): Promise<void> {
  "use server";
  const taskId = parseOrThrow(Id, id);
  const { orgId, role } = await requireTaskContext();
  authorize(role, "task", "delete");
  const db = await getDb();
  await db
    .update(tasks)
    .set({ deletedAt: null, deletedBy: null })
    .where(and(eq(tasks.id, taskId), eq(tasks.organizationId, orgId)));
}

// ---- task links (blocking dependencies + related) -------------------------

/** All task links of the active org (small scale; the client indexes per task). */
export async function listTaskLinks(): Promise<TaskLink[]> {
  "use server";
  const { orgId, role } = await requireTaskContext();
  authorize(role, "task", "update");
  const db = await getDb();
  const rows = await db.select().from(taskLinks).where(eq(taskLinks.organizationId, orgId));
  return rows.map(r => ({
    id: r.id,
    fromTaskId: r.fromTaskId,
    toTaskId: r.toTaskId,
    type: r.type as TaskLinkType,
  }));
}

export async function addTaskLink(
  fromTaskId: string,
  toTaskId: string,
  type: TaskLinkType,
): Promise<TaskLink> {
  "use server";
  const from = parseOrThrow(Id, fromTaskId);
  const to = parseOrThrow(Id, toTaskId);
  const t = parseOrThrow(TaskLinkTypeSchema, type) as TaskLinkType;
  if (from === to) throw new Error("A task can't link to itself");
  const { orgId, role } = await requireTaskContext();
  authorize(role, "task", "update");
  const db = await getDb();
  // both endpoints must live in this org and not be deleted
  const found = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.organizationId, orgId), inArray(tasks.id, [from, to]), isNull(tasks.deletedAt)));
  if (found.length !== 2) throw new Error("Unknown task");

  if (t === "blocks") {
    // reject the inverse (A blocks B + B blocks A is a direct cycle)
    const inverse = await db
      .select({ id: taskLinks.id })
      .from(taskLinks)
      .where(and(eq(taskLinks.fromTaskId, to), eq(taskLinks.toTaskId, from), eq(taskLinks.type, "blocks")));
    if (inverse.length) throw new Error("That would create a blocking cycle");
    const dup = await db
      .select({ id: taskLinks.id })
      .from(taskLinks)
      .where(and(eq(taskLinks.fromTaskId, from), eq(taskLinks.toTaskId, to), eq(taskLinks.type, "blocks")));
    if (dup.length) throw new Error("That dependency already exists");
  } else {
    // related is symmetric — dedupe in either direction
    const existing = await db
      .select({ id: taskLinks.id })
      .from(taskLinks)
      .where(
        and(
          eq(taskLinks.type, "related"),
          or(
            and(eq(taskLinks.fromTaskId, from), eq(taskLinks.toTaskId, to)),
            and(eq(taskLinks.fromTaskId, to), eq(taskLinks.toTaskId, from)),
          ),
        ),
      );
    if (existing.length) throw new Error("Those tasks are already linked");
  }

  const row = {
    id: crypto.randomUUID(),
    organizationId: orgId,
    fromTaskId: from,
    toTaskId: to,
    type: t,
    createdAt: Date.now(),
  };
  await db.insert(taskLinks).values(row);
  return { id: row.id, fromTaskId: from, toTaskId: to, type: t };
}

export async function removeTaskLink(id: string): Promise<void> {
  "use server";
  const linkId = parseOrThrow(Id, id);
  const { orgId, role } = await requireTaskContext();
  authorize(role, "task", "update");
  const db = await getDb();
  await db.delete(taskLinks).where(and(eq(taskLinks.id, linkId), eq(taskLinks.organizationId, orgId)));
}

/** Org members for the assignee picker (excludes guests). */
export async function listAssignees(): Promise<{ userId: string; name: string }[]> {
  "use server";
  const { orgId, role } = await requireTaskContext();
  authorize(role, "task", "update");
  const db = await getDb();
  const rows = await db
    .select({ userId: user.id, name: user.name, role: member.role })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, orgId))
    .orderBy(asc(user.name));
  return rows.filter(r => r.role !== "guest").map(r => ({ userId: r.userId, name: r.name }));
}
