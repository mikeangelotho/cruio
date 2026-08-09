import { randomUUID } from "node:crypto";
import * as v from "valibot";
import { NoArgs, Text, Uuid, defineAction, type Action } from "./define";
import {
  archiveProject,
  createDeliverable,
  getProjectGraph,
  listArchivedProjects,
  listHistory,
  listProjects,
  renameDeliverable,
  renameProject,
  setDeliverableMetadata,
  setProjectStatus,
} from "../api";
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

// The agent's tool catalog — reads, search, and the mutations the assistant is
// allowed to perform on the user's behalf. Every wrapped "use server" function
// does its own authorization/validation, so exposing one here just surfaces an
// existing capability to the model; the role gate still runs server-side on each
// call (e.g. rename_project rejects for non-admins). Destructive, irreversible
// operations (permanent project delete, deliverable/version delete) are
// deliberately NOT exposed — archive is the reversible alternative the AI gets.

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
        status: p.status,
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
        project: { id: g.project.id, name: g.project.name, status: g.project.status },
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

  defineAction({
    name: "rename_project",
    title: "Rename a project",
    description:
      "Change a project's name. Resolve projectId with list_projects or search first — do not guess ids. Requires admin/owner; the server rejects it otherwise.",
    schema: v.object({ projectId: Uuid, name: Text(120) }),
    mutates: true,
    permission: { resource: "project", action: "update" },
    run: async ({ projectId, name }) => {
      await renameProject(projectId, name);
      return { id: projectId, name };
    },
    summarize: r => `renamed to “${(r as { name: string }).name}”`,
  }),

  defineAction({
    name: "set_project_status",
    title: "Set project status",
    description:
      "Move a project to todo, in_progress, or done. The server gates advancing past tasks that aren't there yet — if it rejects, relay that the project's tasks must reach that status first.",
    schema: v.object({ projectId: Uuid, status: Status }),
    mutates: true,
    permission: { resource: "project", action: "update" },
    run: async ({ projectId, status }) => {
      await setProjectStatus(projectId, status);
      return { id: projectId, status };
    },
    summarize: r => `status → ${(r as { status: string }).status}`,
  }),

  defineAction({
    name: "archive_project",
    title: "Archive a project",
    description:
      "Archive a project — it leaves the active lists but stays restorable from the Archived section. Requires admin/owner. This is reversible; there is no permanent-delete tool.",
    schema: v.object({ projectId: Uuid }),
    mutates: true,
    permission: { resource: "project", action: "delete" },
    run: async ({ projectId }) => {
      await archiveProject(projectId);
      return { id: projectId, archived: true };
    },
    summarize: () => "archived",
  }),

  defineAction({
    name: "create_deliverable",
    title: "Create a deliverable",
    description:
      "Add a new (empty) deliverable to a project's canvas. Resolve projectId with list_projects/get_project first. It starts as a draft with no versions.",
    schema: v.object({ projectId: Uuid, name: Text(120) }),
    mutates: true,
    permission: { resource: "deliverable", action: "create" },
    run: async ({ projectId, name }) => {
      const id = randomUUID();
      await createDeliverable(id, projectId, name, 0, 0, "", null);
      return { id, name };
    },
    summarize: r => (r as { name: string }).name,
  }),

  defineAction({
    name: "rename_deliverable",
    title: "Rename a deliverable",
    description:
      "Change a deliverable's name. Resolve deliverableId with get_project or search first — do not guess ids.",
    schema: v.object({ deliverableId: Uuid, name: Text(120) }),
    mutates: true,
    permission: { resource: "deliverable", action: "update" },
    run: async ({ deliverableId, name }) => {
      await renameDeliverable(deliverableId, name);
      return { id: deliverableId, name };
    },
    summarize: r => `renamed to “${(r as { name: string }).name}”`,
  }),

  defineAction({
    name: "set_deliverable_metadata",
    title: "Set deliverable metadata",
    description:
      "Replace a deliverable's custom metadata — reference links (label + url) and key/value fields. Sends the FULL desired set; both arrays overwrite what's there. Fetch current state first if you only mean to add.",
    schema: v.object({
      deliverableId: Uuid,
      links: v.optional(v.array(v.object({ label: v.string(), url: v.string() })), []),
      fields: v.optional(v.array(v.object({ key: v.string(), value: v.string() })), []),
    }),
    mutates: true,
    permission: { resource: "deliverable", action: "update" },
    run: async ({ deliverableId, links, fields }) => {
      await setDeliverableMetadata(deliverableId, { links, fields });
      return { id: deliverableId, links: links.length, fields: fields.length };
    },
    summarize: r => {
      const x = r as { links: number; fields: number };
      return `${x.links} link(s), ${x.fields} field(s)`;
    },
  }),
];

export const ACTIONS_BY_NAME = new Map(ACTIONS.map(a => [a.name, a]));
