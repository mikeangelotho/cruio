import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { Icon } from "@iconify-icon/solid";
import { Avatar } from "./Avatar";
import { NavMenu } from "./NavMenu";
import { PRIORITIES, priorityMeta } from "../lib/priority";
import type { TaskPatchInput } from "../lib/task-api";
import type { Task, TaskLink, TaskLinkType, TaskStatus } from "../lib/types";

const STATUSES: { value: TaskStatus; label: string }[] = [
  { value: "todo", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Done" },
];

/** One dependency/related group in the task panel: existing links + an add picker. */
function LinkSection(props: {
  label: string;
  icon: string;
  rows: { link: TaskLink; other: Task | undefined }[];
  candidates: Task[];
  onRemove: (id: string) => void;
  onPick: (taskId: string) => void;
}) {
  return (
    <div>
      <div class="flex items-center gap-1.5 mb-1">
        <Icon icon={props.icon} width="12" class="text-neutral-400" />
        <span class="text-[11px] text-neutral-400">{props.label}</span>
      </div>
      <div class="space-y-1">
        <For each={props.rows}>
          {r => (
            <div class="flex items-center gap-1.5 text-xs">
              <span
                class="size-1.5 rounded-full shrink-0"
                classList={{
                  "bg-emerald-500": r.other?.status === "done",
                  "bg-neutral-300": r.other?.status !== "done",
                }}
              />
              <span
                class="flex-1 min-w-0 truncate text-neutral-700"
                classList={{ "line-through text-neutral-400": r.other?.status === "done" }}
              >
                {r.other?.title ?? "Unknown task"}
              </span>
              <button
                class="shrink-0 text-neutral-300 hover:text-rose-600 cursor-pointer"
                title="Remove link"
                onClick={() => props.onRemove(r.link.id)}
              >
                <Icon icon="iconoir:xmark" width="12" />
              </button>
            </div>
          )}
        </For>
        <NavMenu
          panelClass="w-56"
          trigger={({ toggle }) => (
            <button
              class="flex items-center gap-1 text-[11px] text-neutral-400 hover:text-neutral-700 cursor-pointer"
              onClick={toggle}
            >
              <Icon icon="iconoir:plus" width="12" /> Add
            </button>
          )}
        >
          {({ close }) => (
            <div class="p-1 max-h-56 overflow-y-auto">
              <Show
                when={props.candidates.length > 0}
                fallback={<p class="px-2 py-2 text-[11px] text-neutral-400">No tasks to link.</p>}
              >
                <For each={props.candidates}>
                  {c => (
                    <button
                      class="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs text-neutral-700 hover:bg-neutral-50 cursor-pointer"
                      onClick={() => {
                        close();
                        props.onPick(c.id);
                      }}
                    >
                      <span class="flex-1 truncate">{c.title}</span>
                    </button>
                  )}
                </For>
              </Show>
            </div>
          )}
        </NavMenu>
      </div>
    </div>
  );
}

/**
 * Full-detail editor for a single task — the ClickUp/Asana "open task" pane.
 * Complements the inline list/board row editing (title click, quick pills)
 * with every field in one place: description, priority, assignee, due date,
 * project link, delete.
 */
export function TaskPanel(props: {
  task: Task | null;
  assignees: { userId: string; name: string }[];
  projects: { id: string; name: string; entityId: string | null }[];
  onClose: () => void;
  onPatch: (id: string, patch: TaskPatchInput, local: Partial<Task>) => void;
  onDelete: (task: Task) => void;
  onOpenProject: (task: Task) => void;
  /** all org tasks (for the link picker + resolving linked titles) */
  allTasks?: Task[];
  links?: TaskLink[];
  onAddLink?: (fromId: string, toId: string, type: TaskLinkType) => void;
  onRemoveLink?: (id: string) => void;
}) {
  const [title, setTitle] = createSignal("");
  const [description, setDescription] = createSignal("");

  // Local edit buffers re-sync whenever a different task is opened (or the
  // same task's fields change under us from an optimistic update elsewhere).
  createEffect(() => {
    const t = props.task;
    setTitle(t?.title ?? "");
    setDescription(t?.description ?? "");
  });

  onMount(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && props.task) props.onClose();
    }
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  return (
    <Show when={props.task}>
      {task => (
        <div class="fixed inset-0 z-40">
          <div class="absolute inset-0 bg-neutral-900/10" onClick={props.onClose} />
          <div class="absolute right-0 top-0 bottom-0 w-[420px] max-w-full bg-white border-l border-neutral-200 shadow-2xl flex flex-col">
            <div class="px-4 py-3 flex items-center justify-between border-b border-neutral-100">
              <div class="flex gap-1">
                <For each={STATUSES}>
                  {s => (
                    <button
                      class="text-[11px] rounded-md px-2 py-1 cursor-pointer"
                      classList={{
                        "bg-neutral-900 text-white": task().status === s.value,
                        "text-neutral-500 hover:bg-neutral-100": task().status !== s.value,
                      }}
                      onClick={() =>
                        props.onPatch(
                          task().id,
                          { status: s.value },
                          {
                            status: s.value,
                            completedAt: s.value === "done" ? Date.now() : null,
                          },
                        )
                      }
                    >
                      {s.label}
                    </button>
                  )}
                </For>
              </div>
              <button
                class="p-1 rounded text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 cursor-pointer"
                title="Close"
                onClick={props.onClose}
              >
                <Icon icon="iconoir:xmark" width="16" />
              </button>
            </div>

            <div class="flex-1 overflow-y-auto px-4 py-4">
              <textarea
                class="w-full text-base font-semibold text-neutral-800 outline-none resize-none placeholder:text-neutral-400"
                rows={title().length > 48 ? 2 : 1}
                value={title()}
                onInput={e => setTitle(e.currentTarget.value)}
                onBlur={() => {
                  const trimmed = title().trim();
                  if (trimmed && trimmed !== task().title) {
                    props.onPatch(task().id, { title: trimmed }, { title: trimmed });
                  } else {
                    setTitle(task().title);
                  }
                }}
              />

              <div class="mt-4 grid grid-cols-[80px_1fr] gap-y-3 text-xs items-center">
                <span class="text-neutral-400">Priority</span>
                <div class="flex gap-1">
                  <For each={PRIORITIES}>
                    {p => (
                      <button
                        class="p-1.5 rounded-md cursor-pointer"
                        classList={{
                          "bg-neutral-100": task().priority === p.value,
                          "hover:bg-neutral-50": task().priority !== p.value,
                        }}
                        title={p.label}
                        onClick={() =>
                          props.onPatch(task().id, { priority: p.value }, { priority: p.value })
                        }
                      >
                        <Icon icon={p.icon} width="14" class={p.color} />
                      </button>
                    )}
                  </For>
                </div>

                <span class="text-neutral-400">Assignee</span>
                <NavMenu
                  panelClass="w-48"
                  trigger={({ toggle }) => (
                    <button
                      class="flex items-center gap-1.5 text-xs text-neutral-700 hover:bg-neutral-50 rounded-md px-2 py-1 -mx-2 cursor-pointer"
                      onClick={toggle}
                    >
                      <Show
                        when={task().assigneeName}
                        fallback={
                          <>
                            <Icon icon="iconoir:user" width="14" class="text-neutral-400" />
                            <span class="text-neutral-400">Unassigned</span>
                          </>
                        }
                      >
                        <Avatar name={task().assigneeName!} size={16} />
                        {task().assigneeName}
                      </Show>
                    </button>
                  )}
                >
                  {({ close }) => (
                    <div class="p-1 max-h-64 overflow-y-auto">
                      <Show when={task().assigneeId}>
                        <button
                          class="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs text-neutral-500 hover:bg-neutral-50 cursor-pointer"
                          onClick={() => {
                            close();
                            props.onPatch(
                              task().id,
                              { assigneeId: null },
                              { assigneeId: null, assigneeName: null },
                            );
                          }}
                        >
                          <Icon icon="iconoir:user-xmark" width="13" /> Unassign
                        </button>
                      </Show>
                      <For each={props.assignees}>
                        {a => (
                          <button
                            class="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs text-neutral-700 hover:bg-neutral-50 cursor-pointer"
                            onClick={() => {
                              close();
                              props.onPatch(
                                task().id,
                                { assigneeId: a.userId },
                                { assigneeId: a.userId, assigneeName: a.name },
                              );
                            }}
                          >
                            <Avatar name={a.name} size={16} />
                            <span class="flex-1 truncate">{a.name}</span>
                            <Show when={a.userId === task().assigneeId}>
                              <Icon icon="iconoir:check" width="12" class="text-neutral-400" />
                            </Show>
                          </button>
                        )}
                      </For>
                    </div>
                  )}
                </NavMenu>

                <span class="text-neutral-400">Due date</span>
                <input
                  type="date"
                  class="text-xs text-neutral-700 border border-neutral-200 rounded-md px-2 py-1 outline-none focus:border-sky-300 w-fit"
                  value={task().dueDate ? new Date(task().dueDate!).toISOString().slice(0, 10) : ""}
                  onChange={e => {
                    const raw = e.currentTarget.value;
                    if (!raw) {
                      props.onPatch(task().id, { dueDate: null }, { dueDate: null });
                      return;
                    }
                    const ts = Date.parse(`${raw}T12:00:00`);
                    if (!Number.isNaN(ts)) {
                      props.onPatch(task().id, { dueDate: ts }, { dueDate: ts });
                    }
                  }}
                />

                <span class="text-neutral-400">Project</span>
                <Show
                  when={task().projectId}
                  fallback={
                    <NavMenu
                      panelClass="w-48"
                      trigger={({ toggle }) => (
                        <button
                          class="text-xs text-neutral-400 hover:text-neutral-700 cursor-pointer"
                          onClick={toggle}
                        >
                          + Link a project
                        </button>
                      )}
                    >
                      {({ close }) => (
                        <div class="p-1 max-h-64 overflow-y-auto">
                          <For each={props.projects}>
                            {p => (
                              <button
                                class="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs text-neutral-700 hover:bg-neutral-50 cursor-pointer"
                                onClick={() => {
                                  close();
                                  props.onPatch(
                                    task().id,
                                    { projectId: p.id },
                                    { projectId: p.id, projectName: p.name, entityId: p.entityId },
                                  );
                                }}
                              >
                                <Icon icon="iconoir:frame" width="13" class="text-neutral-400" />
                                <span class="flex-1 truncate">{p.name}</span>
                              </button>
                            )}
                          </For>
                        </div>
                      )}
                    </NavMenu>
                  }
                >
                  <button
                    class="flex items-center gap-1.5 text-xs text-sky-600 hover:underline cursor-pointer w-fit"
                    onClick={() => props.onOpenProject(task())}
                  >
                    <Icon icon="iconoir:frame" width="13" />
                    {task().projectName}
                  </button>
                </Show>
              </div>

              <Show when={props.links && props.onAddLink && props.onRemoveLink}>
                {(() => {
                  const links = () => props.links ?? [];
                  const all = () => props.allTasks ?? [];
                  const lookup = (id: string) => all().find(x => x.id === id);
                  const blockedBy = createMemo(() =>
                    links().filter(l => l.type === "blocks" && l.toTaskId === task().id),
                  );
                  const blocking = createMemo(() =>
                    links().filter(l => l.type === "blocks" && l.fromTaskId === task().id),
                  );
                  const related = createMemo(() =>
                    links().filter(
                      l => l.type === "related" && (l.fromTaskId === task().id || l.toTaskId === task().id),
                    ),
                  );
                  const otherOf = (l: TaskLink) => (l.fromTaskId === task().id ? l.toTaskId : l.fromTaskId);
                  const candidates = (excluded: Set<string>) =>
                    all().filter(x => x.id !== task().id && !excluded.has(x.id));
                  return (
                    <div class="mt-5 grid grid-cols-3 gap-3">
                      <LinkSection
                        label="Blocked by"
                        icon="iconoir:lock"
                        rows={blockedBy().map(l => ({ link: l, other: lookup(l.fromTaskId) }))}
                        candidates={candidates(new Set(blockedBy().map(l => l.fromTaskId)))}
                        onRemove={id => props.onRemoveLink!(id)}
                        onPick={id => props.onAddLink!(id, task().id, "blocks")}
                      />
                      <LinkSection
                        label="Blocking"
                        icon="iconoir:git-fork"
                        rows={blocking().map(l => ({ link: l, other: lookup(l.toTaskId) }))}
                        candidates={candidates(new Set(blocking().map(l => l.toTaskId)))}
                        onRemove={id => props.onRemoveLink!(id)}
                        onPick={id => props.onAddLink!(task().id, id, "blocks")}
                      />
                      <LinkSection
                        label="Related"
                        icon="iconoir:link"
                        rows={related().map(l => ({ link: l, other: lookup(otherOf(l)) }))}
                        candidates={candidates(new Set(related().map(otherOf)))}
                        onRemove={id => props.onRemoveLink!(id)}
                        onPick={id => props.onAddLink!(task().id, id, "related")}
                      />
                    </div>
                  );
                })()}
              </Show>

              <div class="mt-5">
                <p class="text-[11px] text-neutral-400 mb-1.5">Description</p>
                <textarea
                  class="w-full min-h-24 text-xs text-neutral-700 border border-neutral-200 rounded-md px-2.5 py-2 outline-none focus:border-sky-300 resize-y placeholder:text-neutral-400"
                  placeholder="Add more detail…"
                  value={description()}
                  onInput={e => setDescription(e.currentTarget.value)}
                  onBlur={() => {
                    if (description() !== task().description) {
                      props.onPatch(
                        task().id,
                        { description: description() },
                        { description: description() },
                      );
                    }
                  }}
                />
              </div>

              <p class="mt-4 text-[10px] text-neutral-300">
                Created {new Date(task().createdAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
                <Show when={task().completedAt}>
                  {" "}· Completed{" "}
                  {new Date(task().completedAt!).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </Show>
              </p>
            </div>

            <div class="px-4 py-3 border-t border-neutral-100">
              <button
                class="flex items-center gap-1.5 text-xs text-rose-600 hover:bg-rose-50 rounded-md px-2 py-1.5 cursor-pointer"
                onClick={() => {
                  props.onDelete(task());
                  props.onClose();
                }}
              >
                <Icon icon="iconoir:trash" width="13" /> Delete task
              </button>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
}
