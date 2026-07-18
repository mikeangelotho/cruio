export type Phase = "pre_production" | "iterations" | "publishing";

export type DeliverableStatus =
  | "draft"
  | "in_review"
  | "revisions_requested"
  | "approved";

export type AnnotationStatus = "open" | "resolved_approved" | "resolved_revision";

export type Decision = "approved" | "revision_requested";

export interface Project {
  id: string;
  name: string;
  clientName: string;
  phase: Phase;
  createdAt: number;
  deliverableCount?: number;
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
  createdAt: number;
  comments: Comment[];
}

export interface Approval {
  id: string;
  deliverableId: string;
  versionId: string;
  decision: Decision;
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
  deliverables: Deliverable[];
}

export function fileUrl(fileName: string) {
  return `/api/files/${fileName}`;
}
