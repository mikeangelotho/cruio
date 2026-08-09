import type { TaskPriority } from "./types";

/** Display metadata for task priority, ordered urgent-first for sorting/grouping.
 * `border`/`bg` drive the kanban board's color-coding (a left accent stripe +
 * a faint tint); left off "none" so an un-prioritized board isn't just tinted. */
export const PRIORITIES: {
  value: TaskPriority;
  label: string;
  icon: string;
  color: string;
  border: string;
  bg: string;
}[] = [
  { value: "urgent", label: "Urgent", icon: "iconoir:warning-triangle", color: "text-rose-600", border: "border-l-rose-500", bg: "bg-accent-rose/60" },
  { value: "high", label: "High", icon: "iconoir:flag-outline", color: "text-orange-500", border: "border-l-orange-400", bg: "bg-accent-orange/50" },
  { value: "medium", label: "Medium", icon: "iconoir:flag-outline", color: "text-amber-500", border: "border-l-amber-400", bg: "bg-accent-amber/50" },
  { value: "low", label: "Low", icon: "iconoir:flag-outline", color: "text-sky-500", border: "border-l-sky-400", bg: "bg-accent-sky/50" },
  { value: "none", label: "No priority", icon: "iconoir:flag-outline", color: "text-neutral-400", border: "border-l-transparent", bg: "" },
];

export function priorityMeta(p: TaskPriority) {
  return PRIORITIES.find(x => x.value === p) ?? PRIORITIES[4];
}
