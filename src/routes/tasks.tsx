import {
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  on,
  onCleanup,
  onMount,
} from "solid-js";
import { createAsync, useNavigate, useSearchParams } from "@solidjs/router";
import { Icon } from "@iconify-icon/solid";
import { AppNav } from "../components/AppNav";
import { AppFooter } from "../components/AppFooter";
import { useScope } from "../components/ScopeProvider";
import { Avatar } from "../components/Avatar";
import { ContextMenu, type MenuState } from "../components/ContextMenu";
import { NavMenu } from "../components/NavMenu";
import { TaskPanel } from "../components/TaskPanel";
import {
  createTask,
  deleteTask,
  listAssignees,
  listTasks,
  updateTask,
  type TaskPatchInput,
} from "../lib/task-api";
import { listProjects } from "../lib/api";
import { myOrgsQuery, requireUserQuery } from "../lib/org-api";
import { PRIORITIES, priorityMeta } from "../lib/priority";
import { useViewerRole } from "../lib/viewer";
import type { Task, TaskPriority, TaskStatus } from "../lib/types";

export const route = {
  preload: () => {
    void requireUserQuery();
    void myOrgsQuery();
  },
};

const GROUPS: { status: TaskStatus; label: string }[] = [
  { status: "todo", label: "To do" },
  { status: "in_progress", label: "In progress" },
  { status: "done", label: "Done" },
];

type ViewMode = "list" | "board";
type GroupBy = "status" | "priority" | "assignee" | "project";
const GROUP_BY_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: "status", label: "Status" },
  { value: "priority", label: "Priority" },
  { value: "assignee", label: "Assignee" },
  { value: "project", label: "Project" },
];

const overdue = (t: Task) =>
  t.dueDate !== null && t.status !== "done" && t.dueDate < Date.now();

export default function TasksPage() {
  const navigate = useNavigate();
  const user = createAsync(() => requireUserQuery());
  const orgs = createAsync(() => myOrgsQuery());
  const scope = useScope();
  const [searchParams] = useSearchParams();

  const { myRole } = useViewerRole(user, orgs);
  // guests never see tasks
  createEffect(() => {
    if (myRole() === "guest") navigate("/", { replace: true });
  });

  const [serverTasks, { refetch }] = createResource(
    () => ({ org: user()?.activeOrganizationId, entity: scope.entity()?.id ?? null }),
    ({ entity }) => listTasks(entity),
  );
  const [assignees] = createResource(
    () => user()?.activeOrganizationId,
    () => listAssignees(),
  );
  const [projectsList] = createResource(
    () => user()?.activeOrganizationId,
    () => listProjects(),
  );

  // Optimistic local copy: mutations apply here immediately, then hit the
  // server; errors refetch to reconverge (same philosophy as the canvas store).
  const [items, setItems] = createSignal<Task[]>([]);
  createEffect(() => {
    const rows = serverTasks();
    if (rows) setItems(rows);
  });

  const [view, setView] = createSignal<ViewMode>("list");
  const [groupBy, setGroupBy] = createSignal<GroupBy>("status");
  const [search, setSearch] = createSignal("");
  const [onlyMine, setOnlyMine] = createSignal(false);
  const [onlyOverdue, setOnlyOverdue] = createSignal(false);
  const [collapsed, setCollapsed] = createSignal<Set<string>>(new Set());
  const [selected, setSelected] = createSignal<Set<string>>(new Set());
  const [panelId, setPanelId] = createSignal<string | null>(null);

  const [creatingIn, setCreatingIn] = createSignal<TaskStatus | null>(null);
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [editingDueId, setEditingDueId] = createSignal<string | null>(null);
  const [ctxMenu, setCtxMenu] = createSignal<MenuState | null>(null);
  const [error, setError] = createSignal("");
  const [highlightId, setHighlightId] = createSignal<string | null>(null);
  const rowRefs = new Map<string, HTMLDivElement>();

  // drag-and-drop state for the board view
  const [dragId, setDragId] = createSignal<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = createSignal<TaskStatus | null>(null);

  // arriving from a search result: flash + scroll to the linked task. The
  // fade-out timer only starts once the task has actually loaded and
  // rendered — tasks() resolves over the network, so a fixed timeout from
  // mount could expire before the row (and its ref) ever exist.
  createEffect(on(
    () => searchParams.task,
    raw => {
      const id = Array.isArray(raw) ? raw[0] : raw;
      if (id) setHighlightId(id);
    },
  ));
  createEffect(on(
    () => {
      const id = highlightId();
      return id && items().some(t => t.id === id) ? id : null;
    },
    id => {
      if (!id) return;
      queueMicrotask(() => rowRefs.get(id)?.scrollIntoView({ behavior: "smooth", block: "center" }));
      const clear = setTimeout(() => setHighlightId(null), 2500);
      onCleanup(() => clearTimeout(clear));
    },
  ));

  function fail(err: unknown) {
    setError(String(err instanceof Error ? err.message : err));
    void refetch();
  }

  function patchLocal(id: string, patch: Partial<Task>) {
    setItems(list => list.map(t => (t.id === id ? { ...t, ...patch } : t)));
  }

  function applyPatch(id: string, patch: TaskPatchInput, local: Partial<Task>) {
    setError("");
    patchLocal(id, local);
    updateTask(id, patch).catch(fail);
  }

  function setStatus(t: Task, status: TaskStatus) {
    applyPatch(t.id, { status }, {
      status,
      completedAt: status === "done" ? Date.now() : null,
    });
  }

  function addTask(title: string, status: TaskStatus) {
    const trimmed = title.trim();
    if (!trimmed) return;
    setError("");
    const id = crypto.randomUUID();
    const optimistic: Task = {
      id,
      organizationId: user()?.activeOrganizationId ?? "",
      title: trimmed,
      description: "",
      status,
      priority: "none",
      assigneeId: null,
      assigneeName: null,
      dueDate: null,
      projectId: null,
      projectName: null,
      entityId: null,
      deliverableId: null,
      createdBy: user()?.userId ?? "",
      createdAt: Date.now(),
      completedAt: null,
    };
    setItems(list => [optimistic, ...list]);
    createTask(id, trimmed, { status }).catch(fail);
  }

  function removeTask(t: Task) {
    setError("");
    setItems(list => list.filter(x => x.id !== t.id));
    deleteTask(t.id).catch(fail);
  }

  function toggleSelect(id: string) {
    setSelected(s => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  const clearSelection = () => setSelected(new Set<string>());

  function bulkMarkDone() {
    for (const id of selected()) {
      const t = items().find(x => x.id === id);
      if (t && t.status !== "done") setStatus(t, "done");
    }
    clearSelection();
  }
  function bulkSetPriority(p: TaskPriority) {
    for (const id of selected()) applyPatch(id, { priority: p }, { priority: p });
    clearSelection();
  }
  function bulkAssign(a: { userId: string; name: string }) {
    for (const id of selected()) {
      applyPatch(id, { assigneeId: a.userId }, { assigneeId: a.userId, assigneeName: a.name });
    }
    clearSelection();
  }
  function bulkDelete() {
    const ids = selected();
    if (!window.confirm(`Delete ${ids.size} task${ids.size === 1 ? "" : "s"}?`)) return;
    for (const id of ids) {
      const t = items().find(x => x.id === id);
      if (t) removeTask(t);
    }
    clearSelection();
  }

  function toggleCollapsed(key: string) {
    setCollapsed(s => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }

  function openTaskMenu(t: Task, x: number, y: number) {
    setCtxMenu({
      x,
      y,
      entries: [
        ...GROUPS.filter(g => g.status !== t.status).map(g => ({
          label: `Mark ${g.label.toLowerCase()}`,
          icon:
            g.status === "done"
              ? "iconoir:check"
              : g.status === "in_progress"
                ? "iconoir:play"
                : "iconoir:circle",
          run: () => setStatus(t, g.status),
        })),
        { separator: true } as const,
        { label: "Open task", icon: "iconoir:expand", run: () => setPanelId(t.id) },
        { separator: true } as const,
        ...PRIORITIES.map(p => ({
          label: `Priority: ${p.label}`,
          icon: p.icon,
          hint: t.priority === p.value ? "current" : undefined,
          run: () => applyPatch(t.id, { priority: p.value }, { priority: p.value }),
        })),
        { separator: true } as const,
        ...(assignees() ?? [])
          .filter(a => a.userId !== t.assigneeId)
          .slice(0, 6)
          .map(a => ({
            label: `Assign → ${a.name}`,
            icon: "iconoir:user" as string,
            run: () =>
              applyPatch(t.id, { assigneeId: a.userId }, {
                assigneeId: a.userId,
                assigneeName: a.name,
              }),
          })),
        ...(t.assigneeId
          ? [
              {
                label: "Unassign",
                icon: "iconoir:user-xmark" as string,
                run: () =>
                  applyPatch(t.id, { assigneeId: null }, {
                    assigneeId: null,
                    assigneeName: null,
                  }),
              },
            ]
          : []),
        { separator: true } as const,
        ...(t.projectId
          ? [
              {
                label: t.deliverableId ? "Open on canvas" : "Open project",
                icon: "iconoir:frame",
                run: () =>
                  navigate(
                    t.deliverableId
                      ? `/p/${t.projectId}/d/${t.deliverableId}`
                      : `/p/${t.projectId}`,
                  ),
              },
            ]
          : (projectsList() ?? []).slice(0, 6).map(p => ({
              label: `Link to ${p.name}`,
              icon: "iconoir:frame" as string,
              run: () =>
                applyPatch(t.id, { projectId: p.id }, {
                  projectId: p.id,
                  projectName: p.name,
                  entityId: p.entityId,
                }),
            }))),
        { separator: true } as const,
        {
          label: "Delete task",
          icon: "iconoir:trash",
          danger: true,
          run: () => removeTask(t),
        },
      ],
    });
  }

  function openProjectFor(t: Task) {
    if (!t.projectId) return;
    navigate(t.deliverableId ? `/p/${t.projectId}/d/${t.deliverableId}` : `/p/${t.projectId}`);
  }

  // n = new task in "To do" (unless typing somewhere)
  onMount(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const typing =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;
      if (typing) return;
      if (e.key === "n" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setCreatingIn("todo");
      }
    }
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  const filtered = createMemo(() => {
    let list = items();
    const q = search().trim().toLowerCase();
    if (q) list = list.filter(t => t.title.toLowerCase().includes(q));
    if (onlyMine()) list = list.filter(t => t.assigneeId === user()?.userId);
    if (onlyOverdue()) list = list.filter(overdue);
    return list;
  });

  const stats = createMemo(() => {
    const list = filtered();
    const done = list.filter(t => t.status === "done").length;
    return { total: list.length, done, pct: list.length ? Math.round((done / list.length) * 100) : 0 };
  });

  const grouped = createMemo(() => {
    const list = filtered();
    const gb = groupBy();
    if (gb === "priority") {
      return PRIORITIES.map(p => ({
        key: p.value as string,
        label: p.label,
        tasks: list.filter(t => t.priority === p.value),
      }));
    }
    if (gb === "assignee" || gb === "project") {
      const buckets = new Map<string, { key: string; label: string; tasks: Task[] }>();
      for (const t of list) {
        const key = gb === "assignee" ? (t.assigneeId ?? "none") : (t.projectId ?? "none");
        const label =
          gb === "assignee" ? (t.assigneeName ?? "Unassigned") : (t.projectName ?? "No project");
        if (!buckets.has(key)) buckets.set(key, { key, label, tasks: [] });
        buckets.get(key)!.tasks.push(t);
      }
      return [...buckets.values()].sort((a, b) => a.label.localeCompare(b.label));
    }
    return GROUPS.map(g => ({ key: g.status as string, label: g.label, tasks: list.filter(t => t.status === g.status) }));
  });

  const boardColumns = createMemo(() =>
    GROUPS.map(g => ({ ...g, tasks: filtered().filter(t => t.status === g.status) })),
  );

  const panelTask = createMemo(() => items().find(t => t.id === panelId()) ?? null);

  function dueBadge(t: Task) {
    return (
      <span
        class="shrink-0 text-[10px] rounded px-1.5 py-0.5"
        classList={{
          "text-rose-600 bg-rose-50": overdue(t),
          "text-neutral-400 bg-neutral-100": !overdue(t),
        }}
      >
        {new Date(t.dueDate!).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
      </span>
    );
  }

  const taskRow = (t: Task) => (
    <div
      ref={el => rowRefs.set(t.id, el)}
      class="group px-3 py-2 flex items-center gap-2 hover:bg-neutral-50 cursor-pointer"
      classList={{
        "bg-amber-50": highlightId() === t.id,
        "bg-sky-50": selected().has(t.id) && highlightId() !== t.id,
      }}
      onContextMenu={e => {
        e.preventDefault();
        openTaskMenu(t, e.clientX, e.clientY);
      }}
      onClick={() => setPanelId(t.id)}
    >
      <button
        class="shrink-0 w-3.5 h-3.5 rounded border flex items-center justify-center cursor-pointer"
        classList={{
          "border-neutral-300 opacity-0 group-hover:opacity-100": !selected().has(t.id),
          "border-sky-500 bg-sky-500 text-white opacity-100": selected().has(t.id),
        }}
        title="Select"
        onClick={e => {
          e.stopPropagation();
          toggleSelect(t.id);
        }}
      >
        <Icon icon="iconoir:check" width="9" />
      </button>

      <button
        class="shrink-0 w-4 h-4 rounded-full border flex items-center justify-center cursor-pointer"
        classList={{
          "border-neutral-300 hover:border-emerald-500 text-transparent hover:text-emerald-500":
            t.status !== "done",
          "border-emerald-500 bg-emerald-500 text-white": t.status === "done",
        }}
        title={t.status === "done" ? "Reopen" : "Mark done"}
        onClick={e => {
          e.stopPropagation();
          setStatus(t, t.status === "done" ? "todo" : "done");
        }}
      >
        <Icon icon="iconoir:check" width="10" />
      </button>

      <Icon
        icon={priorityMeta(t.priority).icon}
        width="13"
        class={`shrink-0 ${priorityMeta(t.priority).color}`}
        title={priorityMeta(t.priority).label}
      />

      <Show
        when={editingId() === t.id}
        fallback={
          <button
            class="flex-1 min-w-0 text-left text-xs cursor-text truncate"
            classList={{
              "text-neutral-800": t.status !== "done",
              "text-neutral-400 line-through": t.status === "done",
            }}
            onClick={e => {
              e.stopPropagation();
              setEditingId(t.id);
            }}
          >
            {t.title}
          </button>
        }
      >
        <input
          class="flex-1 min-w-0 text-xs bg-white border border-sky-300 rounded px-1.5 py-1 outline-none"
          value={t.title}
          ref={el => queueMicrotask(() => el.select())}
          onClick={e => e.stopPropagation()}
          onKeyDown={e => {
            if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
            if (e.key === "Escape") {
              (e.currentTarget as HTMLInputElement).value = t.title;
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
          onBlur={e => {
            setEditingId(null);
            const title = e.currentTarget.value.trim();
            if (title && title !== t.title) applyPatch(t.id, { title }, { title });
          }}
        />
      </Show>

      <Show when={t.projectName}>
        <span class="shrink-0 text-[10px] text-neutral-500 bg-[#efeded] rounded px-1.5 py-0.5 truncate max-w-32">
          {t.projectName}
        </span>
      </Show>

      <Show
        when={editingDueId() === t.id}
        fallback={
          <Show
            when={t.dueDate}
            fallback={
              <button
                class="shrink-0 p-0.5 rounded text-neutral-300 opacity-0 group-hover:opacity-100 hover:text-neutral-600 hover:bg-neutral-100 cursor-pointer"
                title="Set due date"
                onClick={e => {
                  e.stopPropagation();
                  setEditingDueId(t.id);
                }}
              >
                <Icon icon="iconoir:calendar-plus" width="13" />
              </button>
            }
          >
            <button
              class="shrink-0"
              onClick={e => {
                e.stopPropagation();
                setEditingDueId(t.id);
              }}
            >
              {dueBadge(t)}
            </button>
          </Show>
        }
      >
        <input
          type="date"
          class="shrink-0 text-[10px] border border-sky-300 rounded px-1 py-0.5 outline-none w-[108px]"
          value={t.dueDate ? new Date(t.dueDate).toISOString().slice(0, 10) : ""}
          ref={el => queueMicrotask(() => el.focus())}
          onClick={e => e.stopPropagation()}
          onChange={e => {
            const raw = e.currentTarget.value;
            setEditingDueId(null);
            if (!raw) {
              applyPatch(t.id, { dueDate: null }, { dueDate: null });
              return;
            }
            const ts = Date.parse(`${raw}T12:00:00`);
            if (!Number.isNaN(ts)) applyPatch(t.id, { dueDate: ts }, { dueDate: ts });
          }}
          onBlur={() => setEditingDueId(null)}
        />
      </Show>

      <Show when={t.assigneeName}>
        <span title={t.assigneeName!}>
          <Avatar name={t.assigneeName!} size={18} />
        </span>
      </Show>
      <button
        class="shrink-0 p-0.5 rounded text-neutral-300 opacity-0 group-hover:opacity-100 hover:text-neutral-600 hover:bg-neutral-100 cursor-pointer"
        title="Task actions"
        onClick={e => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          openTaskMenu(t, r.left, r.bottom + 4);
        }}
      >
        <Icon icon="iconoir:more-horiz" width="14" />
      </button>
    </div>
  );

  const boardCard = (t: Task) => (
    <div
      ref={el => rowRefs.set(t.id, el)}
      draggable={true}
      onDragStart={() => setDragId(t.id)}
      onDragEnd={() => setDragId(null)}
      onClick={() => setPanelId(t.id)}
      onContextMenu={e => {
        e.preventDefault();
        openTaskMenu(t, e.clientX, e.clientY);
      }}
      class="bg-white border border-neutral-200 rounded-lg p-2.5 cursor-pointer hover:border-neutral-300 hover:shadow-sm"
      classList={{ "bg-amber-50": highlightId() === t.id, "opacity-40": dragId() === t.id }}
    >
      <div class="flex items-start gap-1.5 mb-1.5">
        <Icon
          icon={priorityMeta(t.priority).icon}
          width="12"
          class={`shrink-0 mt-0.5 ${priorityMeta(t.priority).color}`}
        />
        <p
          class="flex-1 min-w-0 text-xs text-neutral-800 break-words"
          classList={{ "text-neutral-400 line-through": t.status === "done" }}
        >
          {t.title}
        </p>
      </div>
      <div class="flex items-center gap-1.5 flex-wrap">
        <Show when={t.projectName}>
          <span class="text-[10px] text-neutral-500 bg-[#efeded] rounded px-1.5 py-0.5 truncate max-w-24">
            {t.projectName}
          </span>
        </Show>
        <Show when={t.dueDate}>{dueBadge(t)}</Show>
        <span class="flex-1" />
        <Show when={t.assigneeName}>
          <span title={t.assigneeName!}>
            <Avatar name={t.assigneeName!} size={16} />
          </span>
        </Show>
      </div>
    </div>
  );

  return (
    <div class="p-1 h-screen bg-[#fffefe]">
      <div class="rounded-lg overflow-clip w-full flex flex-col h-full border border-[#eceaea]">
        <AppNav onOrgSwitch={() => void refetch()} />

        <main class="flex-1 overflow-y-auto p-8">
          <div class="max-w-4xl mx-auto">
            <div class="flex items-center justify-between mb-3">
              <div>
                <h1 class="text-lg font-semibold text-neutral-800">Tasks</h1>
                <Show when={stats().total > 0}>
                  <div class="flex items-center gap-2 mt-1.5">
                    <div class="w-28 h-1 rounded-full bg-neutral-100 overflow-hidden">
                      <div
                        class="h-full bg-emerald-500 rounded-full"
                        style={{ width: `${stats().pct}%` }}
                      />
                    </div>
                    <span class="text-[10px] text-neutral-400">
                      {stats().done}/{stats().total} done · {stats().pct}%
                    </span>
                  </div>
                </Show>
              </div>
              <button
                class="flex items-center gap-1 text-xs bg-neutral-900 text-white rounded-md px-3 py-1.5 hover:bg-neutral-700 cursor-pointer"
                onClick={() => setCreatingIn("todo")}
              >
                <Icon icon="iconoir:plus" width="14" /> New task
                <span class="text-[10px] text-neutral-400 bg-neutral-800 rounded px-1 ml-1">N</span>
              </button>
            </div>

            <div class="flex items-center gap-2 mb-5 flex-wrap">
              <div class="flex items-center bg-neutral-100 rounded-md p-0.5">
                <button
                  class="flex items-center gap-1 text-[11px] rounded px-2 py-1 cursor-pointer"
                  classList={{
                    "bg-white shadow-sm text-neutral-800": view() === "list",
                    "text-neutral-500": view() !== "list",
                  }}
                  onClick={() => setView("list")}
                >
                  <Icon icon="iconoir:list" width="13" /> List
                </button>
                <button
                  class="flex items-center gap-1 text-[11px] rounded px-2 py-1 cursor-pointer"
                  classList={{
                    "bg-white shadow-sm text-neutral-800": view() === "board",
                    "text-neutral-500": view() !== "board",
                  }}
                  onClick={() => setView("board")}
                >
                  <Icon icon="iconoir:view-columns-3" width="13" /> Board
                </button>
              </div>

              <Show when={view() === "list"}>
                <NavMenu
                  panelClass="w-36"
                  trigger={({ toggle }) => (
                    <button
                      class="flex items-center gap-1 text-[11px] text-neutral-500 hover:bg-neutral-100 rounded-md px-2 py-1.5 cursor-pointer"
                      onClick={toggle}
                    >
                      <Icon icon="iconoir:sort" width="13" />
                      Group: {GROUP_BY_OPTIONS.find(o => o.value === groupBy())?.label}
                    </button>
                  )}
                >
                  {({ close }) => (
                    <div class="p-1">
                      <For each={GROUP_BY_OPTIONS}>
                        {o => (
                          <button
                            class="w-full flex items-center justify-between px-2 py-1.5 rounded text-left text-xs text-neutral-700 hover:bg-neutral-50 cursor-pointer"
                            onClick={() => {
                              close();
                              setGroupBy(o.value);
                            }}
                          >
                            {o.label}
                            <Show when={groupBy() === o.value}>
                              <Icon icon="iconoir:check" width="12" class="text-neutral-400" />
                            </Show>
                          </button>
                        )}
                      </For>
                    </div>
                  )}
                </NavMenu>
              </Show>

              <button
                class="text-[11px] rounded-md px-2 py-1.5 cursor-pointer"
                classList={{
                  "bg-sky-100 text-sky-700": onlyMine(),
                  "text-neutral-500 hover:bg-neutral-100": !onlyMine(),
                }}
                onClick={() => setOnlyMine(v => !v)}
              >
                My tasks
              </button>
              <button
                class="text-[11px] rounded-md px-2 py-1.5 cursor-pointer"
                classList={{
                  "bg-rose-100 text-rose-700": onlyOverdue(),
                  "text-neutral-500 hover:bg-neutral-100": !onlyOverdue(),
                }}
                onClick={() => setOnlyOverdue(v => !v)}
              >
                Overdue
              </button>

              <div class="flex-1 min-w-24 max-w-64 ml-auto relative">
                <Icon
                  icon="iconoir:search"
                  width="13"
                  class="absolute left-2 top-1/2 -translate-y-1/2 text-neutral-300"
                />
                <input
                  class="w-full text-[11px] bg-neutral-50 border border-neutral-200 rounded-md pl-6 pr-2 py-1.5 outline-none focus:border-sky-300 placeholder:text-neutral-400"
                  placeholder="Filter tasks…"
                  value={search()}
                  onInput={e => setSearch(e.currentTarget.value)}
                />
              </div>
            </div>

            <Show when={error()}>
              <p class="mb-4 text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded px-3 py-2">
                {error()}
              </p>
            </Show>

            <Show when={view() === "list"}>
              <For each={grouped()}>
                {group => (
                  <div class="mb-6">
                    <div class="flex items-center gap-2 mb-2">
                      <button
                        class="cursor-pointer text-neutral-400 hover:text-neutral-600"
                        onClick={() => toggleCollapsed(`${groupBy()}:${group.key}`)}
                      >
                        <Icon
                          icon="iconoir:nav-arrow-down"
                          width="12"
                          class={collapsed().has(`${groupBy()}:${group.key}`) ? "-rotate-90" : ""}
                        />
                      </button>
                      <h2 class="text-xs font-semibold text-neutral-400 uppercase tracking-wide">
                        {group.label}
                      </h2>
                      <span class="text-[10px] text-neutral-400">{group.tasks.length}</span>
                      <Show when={groupBy() === "status"}>
                        <button
                          class="text-neutral-300 hover:text-neutral-600 cursor-pointer"
                          title={`Add to ${group.label}`}
                          onClick={() => setCreatingIn(group.key as TaskStatus)}
                        >
                          <Icon icon="iconoir:plus" width="12" />
                        </button>
                      </Show>
                    </div>
                    <Show when={!collapsed().has(`${groupBy()}:${group.key}`)}>
                      <div class="border border-neutral-200 rounded-lg bg-white divide-y divide-neutral-100">
                        <Show when={groupBy() === "status" && creatingIn() === group.key}>
                          <div class="px-3 py-2 flex items-center gap-2.5">
                            <span class="w-4 h-4 rounded-full border border-dashed border-neutral-300" />
                            <input
                              class="flex-1 text-xs bg-white outline-none placeholder:text-neutral-400"
                              placeholder="Task title — Enter to add, Esc to cancel"
                              ref={el => queueMicrotask(() => el.focus())}
                              onKeyDown={e => {
                                const input = e.target as HTMLInputElement;
                                if (e.key === "Enter") {
                                  addTask(input.value, group.key as TaskStatus);
                                  input.value = "";
                                }
                                if (e.key === "Escape") setCreatingIn(null);
                              }}
                              onBlur={() => setCreatingIn(null)}
                            />
                          </div>
                        </Show>
                        <For each={group.tasks}>{taskRow}</For>
                        <Show when={group.tasks.length === 0 && creatingIn() !== group.key}>
                          <p class="px-3 py-3 text-[11px] text-neutral-400">
                            {group.key === "todo"
                              ? "Nothing here — press N to add a task."
                              : "—"}
                          </p>
                        </Show>
                      </div>
                    </Show>
                  </div>
                )}
              </For>
            </Show>

            <Show when={view() === "board"}>
              <div class="flex gap-4 items-start">
                <For each={boardColumns()}>
                  {col => (
                    <div
                      class="flex-1 min-w-0 rounded-lg p-2"
                      classList={{ "bg-sky-50/60 outline outline-dashed outline-sky-200": dragOverStatus() === col.status }}
                      onDragOver={e => {
                        e.preventDefault();
                        setDragOverStatus(col.status);
                      }}
                      onDragLeave={() => setDragOverStatus(s => (s === col.status ? null : s))}
                      onDrop={e => {
                        e.preventDefault();
                        const id = dragId();
                        setDragOverStatus(null);
                        setDragId(null);
                        if (!id) return;
                        const t = items().find(x => x.id === id);
                        if (t && t.status !== col.status) setStatus(t, col.status);
                      }}
                    >
                      <div class="flex items-center gap-2 mb-2 px-1">
                        <h2 class="text-xs font-semibold text-neutral-500 uppercase tracking-wide">
                          {col.label}
                        </h2>
                        <span class="text-[10px] text-neutral-400">{col.tasks.length}</span>
                        <button
                          class="ml-auto text-neutral-300 hover:text-neutral-600 cursor-pointer"
                          title={`Add to ${col.label}`}
                          onClick={() => setCreatingIn(col.status)}
                        >
                          <Icon icon="iconoir:plus" width="13" />
                        </button>
                      </div>
                      <div class="flex flex-col gap-2">
                        <Show when={creatingIn() === col.status}>
                          <div class="bg-white border border-sky-300 rounded-lg p-2">
                            <input
                              class="w-full text-xs bg-white outline-none placeholder:text-neutral-400"
                              placeholder="Task title — Enter to add"
                              ref={el => queueMicrotask(() => el.focus())}
                              onKeyDown={e => {
                                const input = e.target as HTMLInputElement;
                                if (e.key === "Enter") {
                                  addTask(input.value, col.status);
                                  input.value = "";
                                }
                                if (e.key === "Escape") setCreatingIn(null);
                              }}
                              onBlur={() => setCreatingIn(null)}
                            />
                          </div>
                        </Show>
                        <For each={col.tasks}>{boardCard}</For>
                        <Show when={col.tasks.length === 0 && creatingIn() !== col.status}>
                          <p class="px-1 text-[11px] text-neutral-300">—</p>
                        </Show>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </main>

        <AppFooter />
      </div>

      <Show when={selected().size > 0}>
        <div class="fixed bottom-5 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 bg-neutral-900 text-white rounded-lg shadow-2xl px-3 py-2 text-xs">
          <span class="px-2 font-medium">{selected().size} selected</span>
          <button
            class="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-white/10 cursor-pointer"
            onClick={bulkMarkDone}
          >
            <Icon icon="iconoir:check" width="13" /> Mark done
          </button>
          <NavMenu
            anchor="top"
            panelClass="w-40"
            trigger={({ toggle }) => (
              <button
                class="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-white/10 cursor-pointer"
                onClick={toggle}
              >
                <Icon icon="iconoir:flag-outline" width="13" /> Priority
              </button>
            )}
          >
            {({ close }) => (
              <div class="p-1">
                <For each={PRIORITIES}>
                  {p => (
                    <button
                      class="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs text-neutral-700 hover:bg-neutral-50 cursor-pointer"
                      onClick={() => {
                        close();
                        bulkSetPriority(p.value);
                      }}
                    >
                      <Icon icon={p.icon} width="13" class={p.color} />
                      {p.label}
                    </button>
                  )}
                </For>
              </div>
            )}
          </NavMenu>
          <NavMenu
            anchor="top"
            panelClass="w-44"
            trigger={({ toggle }) => (
              <button
                class="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-white/10 cursor-pointer"
                onClick={toggle}
              >
                <Icon icon="iconoir:user" width="13" /> Assign
              </button>
            )}
          >
            {({ close }) => (
              <div class="p-1 max-h-56 overflow-y-auto">
                <For each={assignees() ?? []}>
                  {a => (
                    <button
                      class="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs text-neutral-700 hover:bg-neutral-50 cursor-pointer"
                      onClick={() => {
                        close();
                        bulkAssign(a);
                      }}
                    >
                      <Avatar name={a.name} size={16} />
                      <span class="truncate">{a.name}</span>
                    </button>
                  )}
                </For>
              </div>
            )}
          </NavMenu>
          <button
            class="flex items-center gap-1 rounded-md px-2 py-1 text-rose-300 hover:bg-white/10 cursor-pointer"
            onClick={bulkDelete}
          >
            <Icon icon="iconoir:trash" width="13" /> Delete
          </button>
          <button
            class="ml-1 rounded-md p-1 hover:bg-white/10 cursor-pointer"
            title="Clear selection"
            onClick={clearSelection}
          >
            <Icon icon="iconoir:xmark" width="14" />
          </button>
        </div>
      </Show>

      <ContextMenu state={ctxMenu()} onClose={() => setCtxMenu(null)} />
      <TaskPanel
        task={panelTask()}
        assignees={assignees() ?? []}
        projects={projectsList() ?? []}
        onClose={() => setPanelId(null)}
        onPatch={applyPatch}
        onDelete={removeTask}
        onOpenProject={openProjectFor}
      />
    </div>
  );
}
