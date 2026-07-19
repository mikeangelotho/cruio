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

// Org-level client (or internal department) that projects are grouped under.
export const clients = sqliteTable("clients", {
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
  clientId: text("client_id").references(() => clients.id),
  phase: text("phase").notNull().default("pre_production"),
  createdBy: text("created_by")
    .notNull()
    .references(() => user.id),
  createdAt: integer("created_at").notNull(),
  // archived projects disappear from lists but are restorable (admin+)
  archivedAt: integer("archived_at"),
  archivedBy: text("archived_by"),
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
  createdAt: integer("created_at").notNull(),
  // soft delete: hidden from the app but restorable from the history panel
  deletedAt: integer("deleted_at"),
  deletedBy: text("deleted_by"),
});

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
