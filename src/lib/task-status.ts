import type { Task, TaskStatus } from "./types";

/**
 * Shared task-status vocabulary. Tasks and projects both move through the same
 * three states (see project-status.ts, where ProjectStatus === TaskStatus), so
 * a single control (StatusControl) and a single meta map serve both. This
 * replaces the STATUS_META copies that had drifted between tasks.tsx and
 * DeliverableTasksPanel.
 */
export const TASK_STATUS_ORDER: TaskStatus[] = ["todo", "in_progress", "done"];

export const TASK_STATUS_META: Record<
  TaskStatus,
  { label: string; dot: string; text: string; chip: string }
> = {
  todo: {
    label: "To do",
    dot: "bg-neutral-300",
    text: "text-neutral-500",
    chip: "bg-accent-neutral text-on-accent-neutral",
  },
  in_progress: {
    label: "In progress",
    dot: "bg-sky-500",
    text: "text-sky-600",
    chip: "bg-accent-sky text-on-accent-sky",
  },
  done: {
    label: "Done",
    dot: "bg-emerald-500",
    text: "text-emerald-600",
    chip: "bg-accent-emerald text-on-accent-emerald",
  },
};

/**
 * The single client-side derivation of the `completedAt`/`status` invariant:
 * `completedAt` is a timestamp iff the task is done. Mirrors the server rule in
 * task-api.updateTask so every optimistic patch (row, detail panel, canvas)
 * stays consistent instead of re-deriving it by hand.
 */
export function statusLocalPatch(status: TaskStatus): Partial<Task> {
  return { status, completedAt: status === "done" ? Date.now() : null };
}
