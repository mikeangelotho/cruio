import type { TaskPriority } from "./types";

/** Display metadata for task priority, ordered urgent-first for sorting/grouping. */
export const PRIORITIES: {
  value: TaskPriority;
  label: string;
  icon: string;
  color: string;
}[] = [
  { value: "urgent", label: "Urgent", icon: "iconoir:warning-triangle", color: "text-rose-600" },
  { value: "high", label: "High", icon: "iconoir:flag-outline", color: "text-orange-500" },
  { value: "medium", label: "Medium", icon: "iconoir:flag-outline", color: "text-amber-500" },
  { value: "low", label: "Low", icon: "iconoir:flag-outline", color: "text-sky-500" },
  { value: "none", label: "No priority", icon: "iconoir:flag-outline", color: "text-neutral-300" },
];

export function priorityMeta(p: TaskPriority) {
  return PRIORITIES.find(x => x.value === p) ?? PRIORITIES[4];
}
