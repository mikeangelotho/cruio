import { randomUUID } from "node:crypto";
import * as v from "valibot";
import { NoArgs, Text, Uuid, defineAction, type Action } from "./define";
import { getProjectGraph, listArchivedProjects, listHistory, listProjects } from "../api";
import { getMyOrganizations, getSessionUser, listEntities, listMembers } from "../org-api";
import { globalSearch } from "../search-api";
import { listTags } from "../tag-api";
import { listLibrary, listProjectFiles } from "../library-api";
import {
  createTask,
  listAssignees,
  listProjectTasks,
  listTasks,
  updateTask,
} from "../task-api";

// Phase 1 action set: enough to prove the whole chain (read, search, and a
// mutation) end to end. Grows to full coverage in Phase 4.
//
// The five list_library/list_project_files/list_project_history/list_members/
// list_archived_projects actions below are a deliberate, scoped exception:
// every "use server" function already does its own authorization/validation,
// so wrapping a READ function is just exposing an existing capability, not
// new logic. No new mutations are added here — that stays gated behind the
// (not yet built) approval flow.

const Status = v.picklist(["todo", "in_progress", "done"]);
const Priority = v.picklist(["none", "low", "medium", "high", "urgent"]);

const TaskFields = {
  description: v.optional(v.pipe(v.string(), v.maxLength(4000))),
  status: v.optional(Status),
  priority: v.optional(Priority),
  assigneeId: v.optional(v.nullable(v.string())),
  dueDate: v.optional(v.nullable(v.number())),
  projectId: v.optional(v.nullable(Uuid)),
  deliverableId: v.optional(v.nullable(Uuid)),
};

export const ACTIONS: Action[] = [
  defineAction({
    name: "whoami",
    title: "Check who you are",
    description:
      "Return the signed-in user and their active workspace. Use this when you need to know who 'me' refers to.",
    schema: NoArgs,
    mutates: false,
    run: async () => {
      const s = await getSessionUser();
      if (!s) return { signedIn: false };
      return {
        signedIn: true,
        userId: s.userId,
        name: s.name,
        email: s.email,
        activeOrganizationId: s.activeOrganizationId,
      };
    },
    summarize: r => (r as { name?: string }).name ?? "unknown",
  }),

  defineAction({
    name: "list_workspaces",
    title: "List workspaces",
    description:
      "List the workspaces (organizations) this user belongs to, with their role in each.",
    schema: NoArgs,
    mutates: false,
    run: () => getMyOrganizations(),
    summarize: r => `${(r as unknown[]).length} workspace(s)`,
  }),

  defineAction({
    name: "list_entities",
    title: "List clients",
    description:
      "List entities — the client companies and internal departments that projects belong to.",
    schema: NoArgs,
    mutates: false,
    run: () => listEntities(),
    summarize: r => `${(r as unknown[]).length} entity(ies)`,
  }),

  defineAction({
    name: "list_projects",
    title: "List projects",
    description:
      "List active projects in the current workspace. Optionally narrow to one entity (client).",
    schema: v.object({
      entityId: v.optional(v.nullable(Uuid), null),
    }),
    mutates: false,
    permission: { resource: "project", action: "read" },
    run: async ({ entityId }) => {
      const projects = await listProjects(entityId ?? null);
      return projects.map(p => ({
        id: p.id,
        name: p.name,
        phase: p.phase,
        entityName: p.entityName,
      }));
    },
    summarize: r => `${(r as unknown[]).length} project(s)`,
  }),

  defineAction({
    name: "get_project",
    title: "Open a project",
    description:
      "Full detail for one project: its deliverables, their latest version and review status, open comment threads, and sticky notes.",
    schema: v.object({ projectId: Uuid }),
    mutates: false,
    permission: { resource: "project", action: "read" },
    run: async ({ projectId }) => {
      const g = await getProjectGraph(projectId);
      if (!g) return { error: "Project not found." };
      return {
        project: { id: g.project.id, name: g.project.name, phase: g.project.phase },
        deliverables: g.deliverables.map(d => ({
          id: d.id,
          name: d.name,
          status: d.status,
          versions: d.versions.length,
          latestVersion: d.versions.at(-1)?.number ?? null,
          openThreads: d.annotations.filter(a => a.status === "open").length,
        })),
        notes: g.canvasObjects.map(o => ({ id: o.id, content: o.content })),
      };
    },
    summarize: r => {
      const g = r as { deliverables?: unknown[] };
      return `${g.deliverables?.length ?? 0} deliverable(s)`;
    },
  }),

  defineAction({
    name: "search",
    title: "Search",
    description:
      "Search across entities, projects, deliverables, tasks, and media. Supports filters: entity:, project:, type:, status:, assignee:, tag:, and is:mine.",
    schema: v.object({ query: Text(200) }),
    mutates: false,
    run: ({ query }) => globalSearch(query),
    summarize: r => `${(r as unknown[]).length} result(s)`,
  }),

  defineAction({
    name: "list_tasks",
    title: "List tasks",
    description:
      "List tasks in the current workspace, newest first. Optionally narrow to one entity (client).",
    schema: v.object({ entityId: v.optional(v.nullable(Uuid), null) }),
    mutates: false,
    permission: { resource: "task", action: "update" },
    run: ({ entityId }) => listTasks(entityId ?? null),
    summarize: r => `${(r as unknown[]).length} task(s)`,
  }),

  defineAction({
    name: "list_project_tasks",
    title: "List a project's tasks",
    description: "List the tasks attached to one project.",
    schema: v.object({ projectId: Uuid }),
    mutates: false,
    permission: { resource: "task", action: "update" },
    run: ({ projectId }) => listProjectTasks(projectId),
    summarize: r => `${(r as unknown[]).length} task(s)`,
  }),

  defineAction({
    name: "list_assignees",
    title: "List assignable people",
    description:
      "List workspace members a task can be assigned to. Call this to resolve a person's name to an assigneeId before creating or updating a task.",
    schema: NoArgs,
    mutates: false,
    permission: { resource: "task", action: "update" },
    run: () => listAssignees(),
    summarize: r => `${(r as unknown[]).length} member(s)`,
  }),

  defineAction({
    name: "list_tags",
    title: "List tags",
    description: "List the tags defined in this workspace.",
    schema: NoArgs,
    mutates: false,
    run: () => listTags(),
    summarize: r => `${(r as unknown[]).length} tag(s)`,
  }),

  defineAction({
    name: "create_task",
    title: "Create a task",
    description:
      "Create a task in the current workspace. Resolve assigneeId with list_assignees and projectId with list_projects first — do not guess ids.",
    schema: v.object({ title: Text(120), ...TaskFields }),
    mutates: true,
    permission: { resource: "task", action: "create" },
    run: async ({ title, ...patch }) => {
      const id = randomUUID();
      await createTask(id, title, patch);
      return { id, title };
    },
    summarize: r => (r as { title: string }).title,
  }),

  defineAction({
    name: "list_library",
    title: "List library files",
    description:
      "List the workspace's library — folders and files, including per-project asset folders. Optionally narrow to one entity (client). Use this for 'what files do we have' style questions.",
    schema: v.object({ entityId: v.optional(v.nullable(Uuid), null) }),
    mutates: false,
    permission: { resource: "library", action: "read" },
    run: async ({ entityId }) => {
      const l = await listLibrary(entityId ?? null);
      return {
        folders: l.folders.map(f => ({ id: f.id, name: f.name, projectId: f.projectId })),
        files: l.files.map(f => ({
          id: f.id,
          name: f.name,
          folderId: f.folderId,
          mime: f.mime,
          size: f.size,
        })),
      };
    },
    summarize: r => {
      const l = r as { folders: unknown[]; files: unknown[] };
      return `${l.folders.length} folder(s), ${l.files.length} file(s)`;
    },
  }),

  defineAction({
    name: "list_project_files",
    title: "List a project's files",
    description: "List every file in one project's library folder.",
    schema: v.object({ projectId: Uuid }),
    mutates: false,
    permission: { resource: "library", action: "read" },
    run: async ({ projectId }) => {
      const files = await listProjectFiles(projectId);
      return files.map(f => ({ id: f.id, name: f.name, mime: f.mime, size: f.size }));
    },
    summarize: r => `${(r as unknown[]).length} file(s)`,
  }),

  defineAction({
    name: "list_project_history",
    title: "List a project's activity",
    description:
      "The project's activity feed — uploads, deliverable/version changes, comments, and approval decisions, newest first.",
    schema: v.object({ projectId: Uuid }),
    mutates: false,
    permission: { resource: "project", action: "read" },
    run: async ({ projectId }) => {
      const rows = await listHistory(projectId);
      return rows.map(h => ({ actorName: h.actorName, detail: h.detail, createdAt: h.createdAt }));
    },
    summarize: r => `${(r as unknown[]).length} event(s)`,
  }),

  defineAction({
    name: "list_members",
    title: "List workspace members",
    description:
      "List who's in the current workspace and their role. Requires admin or owner — tell the user plainly if they don't have permission.",
    schema: NoArgs,
    mutates: false,
    permission: { resource: "member", action: "update" },
    run: async () => {
      const s = await getSessionUser();
      if (!s?.activeOrganizationId) return [];
      const rows = await listMembers(s.activeOrganizationId);
      return rows.map(m => ({ name: m.name, email: m.email, role: m.role }));
    },
    summarize: r => `${(r as unknown[]).length} member(s)`,
  }),

  defineAction({
    name: "list_archived_projects",
    title: "List archived projects",
    description:
      "List archived (closed-out) projects. Optionally narrow to one entity (client). Returns nothing for members without admin/owner access, rather than an error.",
    schema: v.object({ entityId: v.optional(v.nullable(Uuid), null) }),
    mutates: false,
    run: async ({ entityId }) => {
      const projects = await listArchivedProjects(entityId ?? null);
      return projects.map(p => ({ id: p.id, name: p.name, entityName: p.entityName }));
    },
    summarize: r => `${(r as unknown[]).length} archived project(s)`,
  }),

  defineAction({
    name: "update_task",
    title: "Update a task",
    description:
      "Change a task's title, description, status, priority, assignee, due date, or the project/deliverable it hangs off.",
    schema: v.object({
      taskId: Uuid,
      title: v.optional(Text(120)),
      ...TaskFields,
    }),
    mutates: true,
    permission: { resource: "task", action: "update" },
    run: async ({ taskId, ...patch }) => {
      await updateTask(taskId, patch);
      return { id: taskId, updated: Object.keys(patch) };
    },
    summarize: r => `updated ${(r as { updated: string[] }).updated.join(", ")}`,
  }),
];

export const ACTIONS_BY_NAME = new Map(ACTIONS.map(a => [a.name, a]));
