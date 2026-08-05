import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { user, organization, invitation } from "./auth-schema";

export * from "./auth-schema";

// Org-level entity — a client (agency workspace) or a department (internal
// workspace) — that projects are grouped under.
export const entities = sqliteTable("entities", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id),
  name: text("name").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id),
  name: text("name").notNull(),
  entityId: text("entity_id").references(() => entities.id),
  status: text("status").notNull().default("todo"),
  createdBy: text("created_by")
    .notNull()
    .references(() => user.id),
  createdAt: integer("created_at").notNull(),
  // archived projects disappear from lists but are restorable (admin+)
  archivedAt: integer("archived_at"),
  archivedBy: text("archived_by"),
});

// Groups multiple deliverables that are size/format variants of the same
// piece of work (e.g. a 1:1, 4:5, and 9:16 cut of one social post) under one
// visible label. Groups nest: parentGroupId links a group into a larger one.
export const deliverableGroups = sqliteTable("deliverable_groups", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  label: text("label").notNull().default(""),
  parentGroupId: text("parent_group_id"),
  // Own frame for a manually-created ("empty") group container. Null for groups
  // created from cards, whose outline is derived from member bounds.
  posX: real("pos_x"),
  posY: real("pos_y"),
  w: real("w"),
  h: real("h"),
  createdAt: integer("created_at").notNull(),
});

export const deliverables = sqliteTable("deliverables", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  name: text("name").notNull(),
  spec: text("spec").notNull().default(""),
  status: text("status").notNull().default("draft"),
  posX: real("pos_x").notNull().default(0),
  posY: real("pos_y").notNull().default(0),
  groupId: text("group_id").references(() => deliverableGroups.id),
  createdAt: integer("created_at").notNull(),
  // soft delete: hidden from the app but restorable from the history panel
  deletedAt: integer("deleted_at"),
  deletedBy: text("deleted_by"),
});

// Freestanding canvas objects (v1: sticky notes) placed on a project's board.
// Deliberately NOT mirrored into the library — they're working notes, not
// assets. `kind` leaves room for titles / reference images later.
export const canvasObjects = sqliteTable("canvas_objects", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  kind: text("kind").notNull().default("note"),
  content: text("content").notNull().default(""),
  color: text("color").notNull().default("yellow"),
  // JSON array of free-text tag strings, e.g. '["urgent","client-feedback"]'
  tags: text("tags").notNull().default("[]"),
  posX: real("pos_x").notNull().default(0),
  posY: real("pos_y").notNull().default(0),
  createdBy: text("created_by")
    .notNull()
    .references(() => user.id),
  // denormalized snapshot, same rationale as comments.author_name
  createdByName: text("created_by_name").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  deletedAt: integer("deleted_at"),
  deletedBy: text("deleted_by"),
});

// Per-user override of a deliverable's or note's canvas position ("personal
// mode"). The shared posX/posY on deliverables/canvas_objects is "sync
// mode" — whoever last moved it. Both layers persist independently; the
// active mode is a client-only preference (see ProjectCanvas layoutMode).
export const personalPositions = sqliteTable(
  "personal_positions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    kind: text("kind").notNull(), // "deliverable" | "note"
    subjectId: text("subject_id").notNull(),
    posX: real("pos_x").notNull(),
    posY: real("pos_y").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("uidx_personal_positions").on(table.userId, table.kind, table.subjectId),
  ],
);

export const versions = sqliteTable(
  "versions",
  {
    id: text("id").primaryKey(),
    deliverableId: text("deliverable_id")
      .notNull()
      .references(() => deliverables.id),
    number: integer("number").notNull(),
    fileName: text("file_name").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    createdAt: integer("created_at").notNull(),
    deletedAt: integer("deleted_at"),
    deletedBy: text("deleted_by"),
  },
  (table) => [index("idx_versions_file_name").on(table.fileName)],
);

export const annotations = sqliteTable("annotations", {
  id: text("id").primaryKey(),
  deliverableId: text("deliverable_id")
    .notNull()
    .references(() => deliverables.id),
  versionId: text("version_id")
    .notNull()
    .references(() => versions.id),
  x: real("x").notNull(),
  y: real("y").notNull(),
  status: text("status").notNull().default("open"),
  createdBy: text("created_by")
    .notNull()
    .references(() => user.id),
  createdAt: integer("created_at").notNull(),
});

export const comments = sqliteTable("comments", {
  id: text("id").primaryKey(),
  annotationId: text("annotation_id")
    .notNull()
    .references(() => annotations.id),
  userId: text("user_id")
    .notNull()
    .references(() => user.id),
  // Denormalized display-name snapshot taken from the session at write time;
  // keeps history readable without joins and survives later renames.
  authorName: text("author_name").notNull(),
  body: text("body").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const approvals = sqliteTable("approvals", {
  id: text("id").primaryKey(),
  deliverableId: text("deliverable_id")
    .notNull()
    .references(() => deliverables.id),
  versionId: text("version_id")
    .notNull()
    .references(() => versions.id),
  decision: text("decision").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id),
  approverName: text("approver_name").notNull(),
  note: text("note").notNull().default(""),
  createdAt: integer("created_at").notNull(),
});

// Per-project access for org members with the `guest` role.
export const projectShares = sqliteTable(
  "project_shares",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("uidx_project_shares").on(table.projectId, table.userId),
  ],
);

// Append-only activity log per project — powers the History panel and the
// restore path for soft-deleted deliverables/versions.
export const history = sqliteTable(
  "history",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    deliverableId: text("deliverable_id"),
    /** id of the row the event is about (version id, deliverable id, …) */
    subjectId: text("subject_id"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    // denormalized snapshot, same rationale as comments.author_name
    actorName: text("actor_name").notNull(),
    type: text("type").notNull(),
    detail: text("detail").notNull().default(""),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("idx_history_project").on(table.projectId, table.createdAt)],
);

// Library folders: workspace-level (projectId null, user-managed) or the
// auto-created per-project folder (projectId set; created with the project,
// deleted only when the project is deleted — survives archive).
export const libraryFolders = sqliteTable(
  "library_folders",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    projectId: text("project_id").references(() => projects.id),
    name: text("name").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [uniqueIndex("uidx_library_folders_project").on(table.projectId)],
);

// Library files. Rows with versionId set are mirrors of deliverable versions —
// they share the version's fileName on disk (no copy) and follow its
// soft-delete state via src/lib/library.ts helpers.
export const libraryFiles = sqliteTable(
  "library_files",
  {
    id: text("id").primaryKey(),
    folderId: text("folder_id")
      .notNull()
      .references(() => libraryFolders.id),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    name: text("name").notNull(),
    fileName: text("file_name").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    width: integer("width"),
    height: integer("height"),
    versionId: text("version_id").references(() => versions.id),
    uploadedBy: text("uploaded_by")
      .notNull()
      .references(() => user.id),
    createdAt: integer("created_at").notNull(),
    deletedAt: integer("deleted_at"),
    deletedBy: text("deleted_by"),
  },
  (table) => [
    index("idx_library_files_file_name").on(table.fileName),
    index("idx_library_files_folder").on(table.folderId),
    uniqueIndex("uidx_library_files_version").on(table.versionId),
  ],
);

// Assignable work items. Entity scoping is derived (task → project →
// entity_id); tasks without a project only appear under "All Entities".
export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: text("status").notNull().default("todo"),
    priority: text("priority").notNull().default("none"),
    assigneeId: text("assignee_id").references(() => user.id),
    dueDate: integer("due_date"),
    projectId: text("project_id").references(() => projects.id),
    deliverableId: text("deliverable_id").references(() => deliverables.id),
    /** set when the task was created from a review comment/thread — links back
     *  to that annotation (see "Create task from comment"). */
    annotationId: text("annotation_id"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: integer("created_at").notNull(),
    completedAt: integer("completed_at"),
    deletedAt: integer("deleted_at"),
    deletedBy: text("deleted_by"),
  },
  (table) => [
    index("idx_tasks_org_status").on(table.organizationId, table.status),
    index("idx_tasks_assignee").on(table.assigneeId),
  ],
);

// Shared org-level tags — a reusable, named, colored vocabulary applied to
// projects and deliverables via the join tables below. Unique per (org, name).
export const tags = sqliteTable(
  "tags",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    name: text("name").notNull(),
    color: text("color").notNull().default("neutral"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [uniqueIndex("uidx_tags_org_name").on(table.organizationId, table.name)],
);

export const projectTags = sqliteTable(
  "project_tags",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id),
  },
  (table) => [
    uniqueIndex("uidx_project_tags").on(table.projectId, table.tagId),
    index("idx_project_tags_tag").on(table.tagId),
  ],
);

export const deliverableTags = sqliteTable(
  "deliverable_tags",
  {
    id: text("id").primaryKey(),
    deliverableId: text("deliverable_id")
      .notNull()
      .references(() => deliverables.id),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id),
  },
  (table) => [
    uniqueIndex("uidx_deliverable_tags").on(table.deliverableId, table.tagId),
    index("idx_deliverable_tags_tag").on(table.tagId),
  ],
);

// Directed links between tasks. type "blocks": from blocks to (⇒ `to` is
// blocked-by `from`). type "related": non-directional reference (one row,
// rendered both ways). Unique per (from, to, type).
export const taskLinks = sqliteTable(
  "task_links",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    fromTaskId: text("from_task_id")
      .notNull()
      .references(() => tasks.id),
    toTaskId: text("to_task_id")
      .notNull()
      .references(() => tasks.id),
    type: text("type").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("uidx_task_links").on(table.fromTaskId, table.toTaskId, table.type),
    index("idx_task_links_from").on(table.fromTaskId),
    index("idx_task_links_to").on(table.toTaskId),
  ],
);

// Project scope attached to a pending guest invitation; copied into
// project_shares when the invitation is accepted.
export const invitationGrants = sqliteTable(
  "invitation_grants",
  {
    id: text("id").primaryKey(),
    invitationId: text("invitation_id")
      .notNull()
      .references(() => invitation.id),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
  },
  (table) => [
    uniqueIndex("uidx_invitation_grants").on(
      table.invitationId,
      table.projectId,
    ),
  ],
);

// AI assistant. Conversations are per-user within a workspace; messages hold
// the raw Anthropic content-block array so thinking/tool_use blocks can be
// echoed back unchanged on the next turn.
export const aiConversations = sqliteTable("ai_conversations", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id),
  userId: text("user_id")
    .notNull()
    .references(() => user.id),
  title: text("title").notNull().default(""),
  projectId: text("project_id").references(() => projects.id),
  state: text("state").notNull().default("idle"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const aiMessages = sqliteTable("ai_messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => aiConversations.id),
  seq: integer("seq").notNull(),
  role: text("role").notNull(),
  /** JSON: the raw content-block array, stored verbatim. */
  content: text("content").notNull(),
  createdAt: integer("created_at").notNull(),
});

// Token ledger. Only the in-platform chat writes here — MCP runs the model on
// the client side, so it costs the workspace nothing.
export const aiUsage = sqliteTable("ai_usage", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id),
  userId: text("user_id")
    .notNull()
    .references(() => user.id),
  conversationId: text("conversation_id").references(() => aiConversations.id),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
  cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});
