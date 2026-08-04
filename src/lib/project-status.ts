import type { TaskStatus } from "./types";

/**
 * A project's overall status. Shares its vocabulary with {@link TaskStatus}
 * so the task-gating rule below is exact: a project can only advance into a
 * status once all of its tasks have reached that same status.
 *
 * Unlike the derived per-deliverable stage (`stage.ts`), this status is
 * *stored* on the project and moved manually (admins/owners), gated by tasks.
 */
export type ProjectStatus = TaskStatus; // "todo" | "in_progress" | "done"

export const PROJECT_STATUS_ORDER: ProjectStatus[] = ["todo", "in_progress", "done"];

/** Position of a status in the lifecycle (todo 0 < in_progress 1 < done 2). */
export const rank = (s: ProjectStatus) => PROJECT_STATUS_ORDER.indexOf(s);

/** Colored dot + chip classes per status (mirrors STAGE_META / the tasks
 *  screen's STATUS_META). Chips use the accent surface/ink pair so they follow
 *  the theme; dots stay saturated -500s that read on light and dark grounds. */
export const PROJECT_STATUS_META: Record<
  ProjectStatus,
  { label: string; dot: string; chip: string }
> = {
  todo: { label: "To do", dot: "bg-neutral-400", chip: "bg-accent-neutral text-on-accent-neutral" },
  in_progress: { label: "In progress", dot: "bg-sky-500", chip: "bg-accent-sky text-on-accent-sky" },
  done: { label: "Done", dot: "bg-emerald-500", chip: "bg-accent-emerald text-on-accent-emerald" },
};

/** Counts of a project's tasks by status. */
export type TaskCounts = { todo: number; in_progress: number; done: number };

/**
 * The highest status every task already satisfies (all tasks at that rank or
 * beyond). A project with no tasks isn't gated, so any target is allowed →
 * "done".
 */
export function highestAllowedStatus(c: TaskCounts): ProjectStatus {
  const total = c.todo + c.in_progress + c.done;
  if (total === 0) return "done";
  if (c.todo === 0 && c.in_progress === 0) return "done";
  if (c.todo === 0) return "in_progress";
  return "todo";
}

/**
 * Whether the project may move from `current` to `target`. Moving backward or
 * staying put is always allowed; advancing requires every task to be at the
 * target status or beyond.
 */
export function canSetStatus(
  current: ProjectStatus,
  target: ProjectStatus,
  c: TaskCounts,
): boolean {
  if (rank(target) <= rank(current)) return true;
  return rank(target) <= rank(highestAllowedStatus(c));
}
