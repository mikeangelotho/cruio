import { For, Show, createSignal } from "solid-js";
import { A } from "@solidjs/router";
import { Icon } from "@iconify-icon/solid";
import type { Task, TaskStatus } from "../lib/types";
import { Avatar } from "./Avatar";
import { StatusControl } from "./StatusControl";

const overdue = (t: Task) =>
  t.dueDate !== null && t.status !== "done" && t.dueDate < Date.now();

const fmtDue = (ts: number) =>
  new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/**
 * Tasks for the deliverable in view, shown in place on the canvas — the task
 * equivalent of ThreadSidebar / HistoryPanel. Presentational: the canvas owns
 * the tasks list and all mutations.
 */
export function DeliverableTasksPanel(props: {
  tasks: Task[];
  canManage: boolean;
  /** true when showing all project tasks (no deliverable in view) */
  projectScope?: boolean;
  onClose: () => void;
  onAdd: (title: string) => void;
  onSetStatus: (task: Task, status: TaskStatus) => void;
}) {
  const [draft, setDraft] = createSignal("");
  // active (open) tasks first, done sink to the bottom; newest-first within each
  const sorted = () =>
    [...props.tasks].sort((a, b) => {
      const ad = a.status === "done" ? 1 : 0;
      const bd = b.status === "done" ? 1 : 0;
      return ad - bd || b.createdAt - a.createdAt;
    });
  const openCount = () => props.tasks.filter(t => t.status !== "done").length;

  function submit() {
    const title = draft().trim();
    if (!title) return;
    props.onAdd(title);
    setDraft("");
  }

  return (
    <aside class="absolute inset-y-0 right-0 z-20 w-[85vw] max-w-sm shadow-xl sm:static sm:z-auto sm:w-80 sm:max-w-none sm:shadow-none sm:shrink-0 h-full flex flex-col border-l border-neutral-200 bg-panel/95 backdrop-blur-sm">
      <div class="h-10 px-3 flex items-center justify-between border-b border-neutral-100">
        <span class="text-xs font-semibold text-neutral-700">
          {props.projectScope ? "Project tasks" : "Tasks"}
          <Show when={openCount() > 0}>
            <span class="ml-1.5 text-[10px] font-normal text-neutral-400">{openCount()} open</span>
          </Show>
        </span>
        <div class="flex items-center gap-2.5">
          <A
            href="/tasks"
            class="flex items-center gap-0.5 text-[10px] text-sky-700 hover:text-sky-900 cursor-pointer"
            title="Open the full Tasks page"
          >
            Open in Tasks
            <Icon icon="iconoir:arrow-up-right" width="11" />
          </A>
          <button
            class="text-[10px] text-neutral-400 hover:text-neutral-700 cursor-pointer"
            onClick={props.onClose}
          >
            Close
          </button>
        </div>
      </div>

      <Show when={props.canManage}>
        <div class="p-2 border-b border-neutral-100">
          <div class="flex items-center gap-1.5">
            <Icon icon="iconoir:plus" width="14" class="shrink-0 text-neutral-400" />
            <input
              class="flex-1 min-w-0 text-xs bg-transparent outline-none placeholder:text-neutral-400"
              placeholder="Add a task…"
              value={draft()}
              onInput={e => setDraft(e.currentTarget.value)}
              onKeyDown={e => {
                e.stopPropagation();
                if (e.key === "Enter") submit();
                if (e.key === "Escape") setDraft("");
              }}
            />
            <Show when={draft().trim()}>
              <button
                class="shrink-0 text-[10px] text-on-brand bg-brand hover:bg-brand-hover rounded px-2 py-1 cursor-pointer"
                onClick={submit}
              >
                Add
              </button>
            </Show>
          </div>
        </div>
      </Show>

      <div class="flex-1 overflow-y-auto">
        <Show
          when={sorted().length > 0}
          fallback={
            <p class="p-4 text-xs text-neutral-400">
              {props.projectScope
                ? "No tasks in this project yet."
                : "No tasks on this deliverable yet."}
              <Show when={props.canManage}> Add one above to track the work.</Show>
            </p>
          }
        >
          <For each={sorted()}>
            {t => (
              <div class="group px-3 py-2.5 border-b border-neutral-100 flex items-start gap-2">
                <div class="shrink-0 mt-0.5">
                  <StatusControl
                    status={t.status}
                    onSelect={s => props.onSetStatus(t, s)}
                    disabled={!props.canManage}
                    portal
                  />
                </div>

                <div class="min-w-0 flex-1">
                  <p
                    class="text-xs leading-snug"
                    classList={{
                      "text-neutral-400 line-through": t.status === "done",
                      "text-neutral-700": t.status !== "done",
                    }}
                  >
                    {t.title}
                  </p>
                  <Show when={t.assigneeName || t.dueDate}>
                    <div class="mt-1 flex items-center gap-2 text-[10px] text-neutral-400">
                      <Show when={t.assigneeName}>
                        <span class="flex items-center gap-1 min-w-0">
                          <Avatar name={t.assigneeName!} size={13} />
                          <span class="truncate">{t.assigneeName}</span>
                        </span>
                      </Show>
                      <Show when={t.dueDate}>
                        <span classList={{ "text-rose-600": overdue(t) }}>{fmtDue(t.dueDate!)}</span>
                      </Show>
                    </div>
                  </Show>
                </div>

                <A
                  href={`/tasks?task=${t.id}`}
                  class="shrink-0 p-1 rounded text-neutral-300 opacity-0 group-hover:opacity-100 hover:text-neutral-700 hover:bg-neutral-100 cursor-pointer"
                  title="Open in Tasks"
                >
                  <Icon icon="iconoir:expand" width="12" />
                </A>
              </div>
            )}
          </For>
        </Show>
      </div>
    </aside>
  );
}
