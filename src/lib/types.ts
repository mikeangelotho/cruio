import type { ProjectStatus, TaskCounts } from "./project-status";

export type DeliverableStatus =
  | "draft"
  | "in_review"
  | "revisions_requested"
  | "approved";

export type AnnotationStatus = "open" | "resolved_approved" | "resolved_revision";

export type Decision = "approved" | "revision_requested";

export type OrgRole = "owner" | "admin" | "member" | "guest";

/** Org-level entity — client company or internal department — that groups projects. */
export interface Entity {
  id: string;
  name: string;
  projectCount?: number;
}

export type TagColor =
  | "neutral"
  | "sky"
  | "emerald"
  | "amber"
  | "rose"
  | "violet";

/** Shared org-level tag applied to projects and deliverables. */
export interface Tag {
  id: string;
  name: string;
  color: TagColor;
}

export interface Project {
  id: string;
  organizationId: string;
  name: string;
  entityId: string | null;
  /** joined from the entities table for display */
  entityName: string | null;
  /** overall project status — moved manually, gated by tasks (see project-status.ts) */
  status: ProjectStatus;
  createdBy: string;
  createdAt: number;
  archivedAt?: number | null;
  deliverableCount?: number;
  tags?: Tag[];
  /** fileName of the most recent version image across the project's deliverables — the card cover */
  cover?: string | null;
  /** counts of deliverables in each non-draft review status, for the card rollup */
  statusCounts?: { in_review: number; revisions_requested: number; approved: number };
  /** counts of the project's tasks by status — powers the status pill's gate */
  taskCounts?: TaskCounts;
}

/** The signed-in user as seen by the project graph; drives role-adaptive UI. */
export interface Viewer {
  userId: string;
  name: string;
  role: OrgRole;
}

export interface Version {
  id: string;
  deliverableId: string;
  number: number;
  fileName: string;
  width: number;
  height: number;
  createdAt: number;
}

export interface Comment {
  id: string;
  annotationId: string;
  userId: string;
  authorName: string;
  body: string;
  createdAt: number;
}

export interface Annotation {
  id: string;
  deliverableId: string;
  versionId: string;
  /** normalized 0-1 relative to the image */
  x: number;
  y: number;
  status: AnnotationStatus;
  createdBy: string;
  createdAt: number;
  comments: Comment[];
}

export interface Approval {
  id: string;
  deliverableId: string;
  versionId: string;
  decision: Decision;
  userId: string;
  approverName: string;
  note: string;
  createdAt: number;
}

export interface Deliverable {
  id: string;
  projectId: string;
  name: string;
  spec: string;
  status: DeliverableStatus;
  posX: number;
  posY: number;
  /** set when this is a size/format variant grouped with sibling deliverables */
  groupId: string | null;
  /** joined for display */
  groupLabel?: string | null;
  createdAt: number;
  tags: Tag[];
  versions: Version[];
  annotations: Annotation[];
  approvals: Approval[];
}

/** A named cluster of deliverables (size/format variants); groups can nest. */
export interface DeliverableGroup {
  id: string;
  label: string;
  parentGroupId: string | null;
  /** own frame for a manually-created empty container; null when derived from members */
  posX: number | null;
  posY: number | null;
  w: number | null;
  h: number | null;
}

export type CanvasObjectKind = "note";

export type NoteColor = "yellow" | "pink" | "blue" | "green";

/** Freestanding board object (v1: sticky notes). Never mirrored to the library. */
export interface CanvasObject {
  id: string;
  projectId: string;
  kind: CanvasObjectKind;
  content: string;
  color: NoteColor;
  tags: string[];
  posX: number;
  posY: number;
  createdBy: string;
  /** joined for display */
  createdByName: string | null;
  createdAt: number;
}

/** A viewer's personal override of a deliverable's or note's canvas
 * position — "personal mode"; the shared posX/posY column is "sync mode". */
export interface PersonalPosition {
  kind: "deliverable" | "note";
  subjectId: string;
  posX: number;
  posY: number;
}

export interface ProjectGraph {
  project: Project;
  viewer: Viewer;
  deliverables: Deliverable[];
  groups: DeliverableGroup[];
  canvasObjects: CanvasObject[];
  personalPositions: PersonalPosition[];
}

export type HistoryType =
  | "project_created"
  | "project_archived"
  | "project_restored"
  | "project_status_changed"
  | "deliverable_created"
  | "deliverable_renamed"
  | "deliverable_deleted"
  | "deliverable_restored"
  | "version_uploaded"
  | "version_deleted"
  | "version_restored"
  | "comment_added"
  | "thread_resolved"
  | "thread_reopened"
  | "decision_approved"
  | "decision_revisions"
  | "task_created"
  | "task_completed";

export interface HistoryEntry {
  id: string;
  projectId: string;
  deliverableId: string | null;
  subjectId: string | null;
  userId: string;
  actorName: string;
  type: HistoryType;
  /** human sentence remainder, e.g. `deleted v2 of “Hero banner”` */
  detail: string;
  createdAt: number;
  /** deleted-type entries only: subject is still deleted and can be restored */
  restorable?: boolean;
}

export type TaskStatus = "todo" | "in_progress" | "done";

export type TaskPriority = "none" | "low" | "medium" | "high" | "urgent";

export interface Task {
  id: string;
  organizationId: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: string | null;
  /** joined for display */
  assigneeName: string | null;
  dueDate: number | null;
  projectId: string | null;
  /** joined for display + entity scoping */
  projectName: string | null;
  entityId: string | null;
  deliverableId: string | null;
  createdBy: string;
  createdAt: number;
  completedAt: number | null;
}

export type TaskLinkType = "blocks" | "related";

/** A directed link between two tasks. "blocks": `from` blocks `to`. "related":
 * non-directional (stored once, rendered both ways). */
export interface TaskLink {
  id: string;
  fromTaskId: string;
  toTaskId: string;
  type: TaskLinkType;
}

export interface LibraryFolder {
  id: string;
  /** set = the auto-created project folder; null = workspace-level folder */
  projectId: string | null;
  name: string;
  createdAt: number;
  /** project folders only: the owning project's entity (drives scoping) */
  entityId: string | null;
  /** joined for display (entity attribution under "All Entities" scope) */
  entityName: string | null;
}

export interface LibraryFile {
  id: string;
  folderId: string;
  name: string;
  fileName: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  /** set = mirror of a deliverable version (managed by the canvas) */
  versionId: string | null;
  /** mirrors only: for linking back to the review canvas */
  deliverableId: string | null;
  uploadedBy: string;
  createdAt: number;
}

export function fileUrl(fileName: string) {
  return `/api/files/${fileName}`;
}
