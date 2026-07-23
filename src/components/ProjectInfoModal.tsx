import { Show, For } from "solid-js";
import { Icon } from "@iconify-icon/solid";
import { STATUS_META } from "./DeliverableCard";
import { StatusRail } from "./StatusRail";
import type { Deliverable, Project, Version } from "../lib/types";

const STATUS_ORDER: Deliverable["status"][] = [
  "draft",
  "in_review",
  "revisions_requested",
  "approved",
];

/**
 * Redundant, at-a-glance project detail — everything the status bar shows
 * (and more), reachable from the info button, the canvas context menu, or
 * the nav kebab. Read-only: this is a summary, not an editor.
 */
export function ProjectInfoModal(props: {
  open: boolean;
  onClose: () => void;
  project: Project;
  deliverables: Deliverable[];
  current?: Deliverable;
  currentVersion?: Version;
  openThreadCount: number;
  /** true when `current` is open in review; false when it's merely selected on the board */
  reviewing?: boolean;
  onOpenHistory: () => void;
}) {
  const counts = () => {
    const tally = { draft: 0, in_review: 0, revisions_requested: 0, approved: 0 };
    for (const d of props.deliverables) tally[d.status]++;
    return tally;
  };

  return (
    <Show when={props.open}>
      <div
        class="fixed inset-0 z-50 bg-black/10 flex items-center justify-center"
        onClick={props.onClose}
      >
        <div
          class="w-[440px] max-w-[90vw] bg-white rounded-xl shadow-2xl border border-neutral-200 overflow-hidden"
          onClick={e => e.stopPropagation()}
        >
          <div class="flex items-start justify-between px-4 pt-4">
            <div class="min-w-0">
              <p class="text-[10px] uppercase tracking-wide text-neutral-400 font-medium">
                Project info
              </p>
              <div class="flex items-center gap-2 mt-1 flex-wrap">
                <h2 class="text-base font-semibold text-neutral-800 truncate">
                  {props.project.name}
                </h2>
                <Show when={props.project.entityName}>
                  <span class="text-xs text-neutral-500 bg-[#efeded] rounded px-1.5 py-0.5">
                    {props.project.entityName}
                  </span>
                </Show>
              </div>
            </div>
            <button
              class="shrink-0 p-1 rounded text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 cursor-pointer"
              title="Close"
              onClick={props.onClose}
            >
              <Icon icon="iconoir:xmark" width="16" />
            </button>
          </div>

          <div class="px-4 mt-3">
            <StatusRail phase={props.project.phase} />
          </div>

          <div class="mt-4 mx-4 border-t border-neutral-100" />

          <div class="px-4 py-3 grid grid-cols-4 gap-2">
            <For each={STATUS_ORDER}>
              {status => (
                <div class="rounded-lg bg-neutral-50 px-2 py-2 text-center">
                  <p class="text-lg font-semibold text-neutral-800 tabular-nums">
                    {counts()[status]}
                  </p>
                  <p class="mt-0.5 flex items-center justify-center gap-1 text-[10px] text-neutral-500">
                    <span class={`size-1.5 rounded-full shrink-0 ${STATUS_META[status].dot}`} />
                    <span class="truncate">{STATUS_META[status].label}</span>
                  </p>
                </div>
              )}
            </For>
          </div>

          <p class="px-4 pb-3 text-[11px] text-neutral-400">
            Created{" "}
            {new Date(props.project.createdAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
            {" · "}
            {props.deliverables.length} deliverable{props.deliverables.length === 1 ? "" : "s"} total
          </p>

          <Show when={props.current}>
            {d => (
              <div class="mx-4 mb-4 rounded-lg border border-neutral-200 bg-neutral-50/60 p-3">
                <p class="text-[10px] uppercase tracking-wide text-neutral-400 font-medium mb-1.5">
                  {props.reviewing ? "Currently viewing" : "Selected"}
                </p>
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-sm font-medium text-neutral-800 truncate">{d().name}</span>
                  <span class={`text-[10px] rounded-full px-1.5 py-px ${STATUS_META[d().status].chip}`}>
                    {STATUS_META[d().status].label}
                  </span>
                </div>
                <div class="mt-2 flex items-center gap-3 flex-wrap text-[11px] text-neutral-500">
                  <Show when={props.currentVersion}>
                    {v => (
                      <span class="flex items-center gap-1">
                        <Icon icon="iconoir:media-image" width="12" />
                        v{v().number} · {v().width}×{v().height}
                      </span>
                    )}
                  </Show>
                  <span
                    class="flex items-center gap-1"
                    classList={{
                      "text-orange-600": props.openThreadCount > 0,
                    }}
                  >
                    <Icon icon="iconoir:chat-bubble" width="12" />
                    {props.openThreadCount} open thread{props.openThreadCount === 1 ? "" : "s"}
                  </span>
                  <span class="flex items-center gap-1">
                    <Icon icon="iconoir:copy" width="12" />
                    {d().versions.length} version{d().versions.length === 1 ? "" : "s"}
                  </span>
                </div>
                <Show when={d().groupId}>
                  <div class="mt-2 pt-2 border-t border-neutral-200/70">
                    <p class="flex items-center gap-1 text-[11px] text-violet-700">
                      <Icon icon="iconoir:link" width="12" />
                      Grouped as “{d().groupLabel}”
                    </p>
                    <p class="mt-1 text-[11px] text-neutral-500 truncate">
                      With: {props.deliverables
                        .filter(o => o.groupId === d().groupId && o.id !== d().id)
                        .map(o => o.name)
                        .join(", ") || "no other members"}
                    </p>
                  </div>
                </Show>
              </div>
            )}
          </Show>

          <div class="px-4 py-2.5 border-t border-neutral-100 flex justify-end">
            <button
              class="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-800 cursor-pointer"
              onClick={() => {
                props.onClose();
                props.onOpenHistory();
              }}
            >
              <Icon icon="iconoir:clock" width="13" /> View full history
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
