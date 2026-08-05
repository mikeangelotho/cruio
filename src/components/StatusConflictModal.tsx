import { For, Show } from "solid-js";
import { Icon } from "@iconify-icon/solid";
import type { TaskStatus } from "../lib/types";
import { TASK_STATUS_META } from "../lib/task-status";

export type ConflictTask = { id: string; title: string; status: TaskStatus };

/**
 * The single confirmation surface for status conflicts — a project advancing
 * past tasks that aren't there yet, or a task marked done while still blocked.
 * Controlled (open/onConfirm/onCancel); drive it with createStatusConfirm for
 * an `await confirm({...})` flow. Copies ProjectInfoModal's scrim shell.
 */
export function StatusConflictModal(props: {
  open: boolean;
  title: string;
  description: string;
  tasks: ConflictTask[];
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Show when={props.open}>
      <div
        class="fixed inset-0 z-50 bg-scrim flex items-center justify-center"
        onClick={props.onCancel}
      >
        <div
          class="w-[440px] max-w-[90vw] bg-panel rounded-xl shadow-2xl border border-neutral-200 overflow-hidden"
          onClick={e => e.stopPropagation()}
        >
          <div class="flex items-start justify-between px-4 pt-4">
            <div class="min-w-0">
              <p class="text-[10px] uppercase tracking-wide text-neutral-400 font-medium">
                Confirm change
              </p>
              <h2 class="text-base font-semibold text-neutral-800 mt-1 truncate">
                {props.title}
              </h2>
            </div>
            <button
              class="shrink-0 p-1 rounded text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 cursor-pointer"
              title="Cancel"
              onClick={props.onCancel}
            >
              <Icon icon="iconoir:xmark" width="16" />
            </button>
          </div>

          <div class="px-4 pt-3">
            <div class="flex items-start gap-2 rounded-lg bg-accent-amber text-on-accent-amber px-3 py-2 text-xs leading-snug">
              <Icon icon="iconoir:warning-triangle" width="14" class="shrink-0 mt-px" />
              <span>{props.description}</span>
            </div>
          </div>

          <Show when={props.tasks.length > 0}>
            <div class="px-4 py-3 max-h-64 overflow-auto">
              <div class="rounded-lg border border-neutral-200 divide-y divide-neutral-100">
                <For each={props.tasks}>
                  {t => (
                    <div class="flex items-center gap-2 px-3 py-2 text-xs">
                      <span class={`size-1.5 rounded-full shrink-0 ${TASK_STATUS_META[t.status].dot}`} />
                      <span class="flex-1 truncate text-neutral-700">{t.title}</span>
                      <span class={`shrink-0 text-[10px] ${TASK_STATUS_META[t.status].text}`}>
                        {TASK_STATUS_META[t.status].label}
                      </span>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Show>

          <div class="px-4 py-2.5 border-t border-neutral-100 flex justify-end gap-2">
            <button
              class="text-xs px-3 py-1.5 rounded-md text-neutral-600 hover:bg-neutral-100 cursor-pointer"
              onClick={props.onCancel}
            >
              Cancel
            </button>
            <button
              class="text-xs px-3 py-1.5 rounded-md bg-brand text-on-brand hover:bg-neutral-700 cursor-pointer"
              onClick={props.onConfirm}
            >
              {props.confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
