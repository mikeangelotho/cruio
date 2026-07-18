import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  clientName: text("client_name").notNull().default(""),
  phase: text("phase").notNull().default("pre_production"),
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
  createdAt: integer("created_at").notNull(),
});

export const versions = sqliteTable("versions", {
  id: text("id").primaryKey(),
  deliverableId: text("deliverable_id")
    .notNull()
    .references(() => deliverables.id),
  number: integer("number").notNull(),
  fileName: text("file_name").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  createdAt: integer("created_at").notNull(),
});

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
  createdAt: integer("created_at").notNull(),
});

export const comments = sqliteTable("comments", {
  id: text("id").primaryKey(),
  annotationId: text("annotation_id")
    .notNull()
    .references(() => annotations.id),
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
  approverName: text("approver_name").notNull(),
  note: text("note").notNull().default(""),
  createdAt: integer("created_at").notNull(),
});
