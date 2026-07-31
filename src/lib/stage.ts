import type { Deliverable, Task } from "./types";

/**
 * A deliverable's lifecycle stage. Unlike the review `status`
 * (draft/in_review/revisions_requested/approved), the stage is never stored —
 * it is *derived* from the review status plus the deliverable's tasks, so it
 * always reflects the real state of the work. This replaces the old
 * project-level phase rail (whitepaper §4).
 */
export type Stage = "to_do" | "in_progress" | "in_review" | "done";

/** Colored dot + chip classes per stage (mirrors DeliverableCard's STATUS_META shape). */
export const STAGE_META: Record<Stage, { label: string; chip: string; dot: string }> = {
  to_do: { label: "To do", chip: "bg-neutral-100 text-neutral-500", dot: "bg-neutral-400" },
  in_progress: { label: "In progress", chip: "bg-sky-50 text-sky-700", dot: "bg-sky-500" },
  in_review: { label: "In review", chip: "bg-violet-50 text-violet-700", dot: "bg-violet-500" },
  done: { label: "Done", chip: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
};

/**
 * Derive a deliverable's stage from its review status and its tasks
 * (evaluated top-down):
 *   1. approved with no incomplete tasks      → done
 *   2. currently in review                    → in_review
 *   3. revisions asked for, a task in progress,
 *      a version exists, or an open thread    → in_progress
 *   4. nothing started                        → to_do
 *
 * `tasks` should already be scoped to this deliverable.
 */
export function deliverableStage(d: Deliverable, tasks: Task[]): Stage {
  const hasIncompleteTasks = tasks.some(t => t.status !== "done");
  const anyTaskInProgress = tasks.some(t => t.status === "in_progress");
  const anyOpenThread = d.annotations.some(a => a.status === "open");

  if (d.status === "approved" && !hasIncompleteTasks) return "done";
  if (d.status === "in_review") return "in_review";
  if (
    d.status === "revisions_requested" ||
    anyTaskInProgress ||
    d.versions.length > 0 ||
    anyOpenThread
  ) {
    return "in_progress";
  }
  return "to_do";
}
