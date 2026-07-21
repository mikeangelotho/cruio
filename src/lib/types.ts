export type Phase = "pre_production" | "iterations" | "publishing";

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

export interface Project {
  id: string;
  organizationId: string;
  name: string;
  entityId: string | null;
  /** joined from the entities table for display */
  entityName: string | null;
  phase: Phase;
  createdBy: string;
  createdAt: number;
  archivedAt?: number | null;
  deliverableCount?: number;
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
  createdAt: number;
  versions: Version[];
  annotations: Annotation[];
  approvals: Approval[];
}

export interface ProjectGraph {
  project: Project;
  viewer: Viewer;
  deliverables: Deliverable[];
}

export type HistoryType =
  | "project_created"
  | "project_archived"
  | "project_restored"
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

export interface LibraryFolder {
  id: string;
  /** set = the auto-created project folder; null = workspace-level folder */
  projectId: string | null;
  name: string;
  createdAt: number;
  /** project folders only: the owning project's entity (drives scoping) */
  entityId: string | null;
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
