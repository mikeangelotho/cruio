import {
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { A, createAsync, revalidate, useNavigate } from "@solidjs/router";
import { Icon } from "@iconify-icon/solid";
import { archiveProject, createProject, deleteProject, listProjects, renameProject, restoreProject, setProjectStatus } from "../lib/api";
import { createUndoStack } from "../lib/undo";
import { confirm, promptText } from "../lib/confirm";
import { getBoolPref, getPref, setBoolPref, setPref } from "../lib/prefs";
import { pushToast, setToastRaised } from "../lib/toast";
import {
  createEntity,
  listEntities,
  myOrgsQuery,
  requireUserQuery,
  sessionQuery,
} from "../lib/org-api";
import { authClient } from "../lib/auth-client";
import { useViewerRole } from "../lib/viewer";
import { onAiInvalidate } from "../lib/ai/invalidate";
import { newId } from "../lib/id";
import { EntityAvatar } from "../components/Avatar";
import { AppNav } from "../components/AppNav";
import { AppFooter } from "../components/AppFooter";
import { useScope } from "../components/ScopeProvider";
import { ContextMenu, type MenuState } from "../components/ContextMenu";
import { EntityOptions } from "../components/EntityOptions";
import { TagChips } from "../components/TagChips";
import { TagPicker } from "../components/TagPicker";
import { NavMenu } from "../components/NavMenu";
import { FilterBar } from "../components/FilterBar";
import { createTag, listTags, setProjectTags } from "../lib/tag-api";
import { listProjectTasks, updateTask } from "../lib/task-api";
import { fileUrl } from "../lib/types";
import type { Project, Tag, TagColor, Task } from "../lib/types";
import {
  PROJECT_STATUS_META,
  canSetStatus,
  rank,
  type ProjectStatus,
  type TaskCounts,
} from "../lib/project-status";
import { TASK_STATUS_META } from "../lib/task-status";
import { StatusControl } from "../components/StatusControl";
import { StatusConflictModal } from "../components/StatusConflictModal";
import { createStatusConfirm } from "../lib/status-confirm";

export const route = {
  preload: () => {
    void requireUserQuery();
    void myOrgsQuery();
  },
};

export default function Home() {
  const navigate = useNavigate();
  const user = createAsync(() => requireUserQuery());
  const orgs = createAsync(() => myOrgsQuery());
  const [projects, { refetch }] = createResource(() => listProjects());
  const scope = useScope();
  const [entitiesList, { refetch: refetchEntities }] =
    createResource(listEntities);
  const [tagsList, { refetch: refetchTags }] = createResource(
    () => user()?.activeOrganizationId ?? null,
    () => listTags(),
  );
  onAiInvalidate(() => {
    void refetch();
    void refetchEntities();
    void refetchTags();
  });
  // Optimistic overlay so toggling a project's tags stays responsive without a
  // full project refetch (which would remount the card and close the picker).
  const [tagOverrides, setTagOverrides] = createSignal<Record<string, Tag[]>>({});
  const projectTags = (p: Project) => tagOverrides()[p.id] ?? p.tags ?? [];
  // Optimistic overlay for the status pill, same rationale as tag overrides —
  // keep the card responsive without a full refetch that would remount it.
  const [statusOverrides, setStatusOverrides] = createSignal<Record<string, ProjectStatus>>({});
  const projectStatus = (p: Project): ProjectStatus => statusOverrides()[p.id] ?? p.status;
  // Optimistic overlay for inline rename, same rationale as tag/status overlays.
  const [nameOverrides, setNameOverrides] = createSignal<Record<string, string>>({});
  const projectName = (p: Project) => nameOverrides()[p.id] ?? p.name;
  const [renamingId, setRenamingId] = createSignal<string | null>(null);

  // ---- undo/redo (per-screen; resets on navigation) ------------------------
  const undo = createUndoStack();
  function record(label: string, undoFn: () => void, redoFn: () => void) {
    undo.push({ label, undo: undoFn, redo: redoFn });
    pushToast(label, { actionLabel: "Undo", onAction: doUndo });
  }
  function doUndo() {
    const c = undo.undo();
    if (c) pushToast(`Undid: ${c.label}`, { actionLabel: "Redo", onAction: doRedo });
  }
  function doRedo() {
    const c = undo.redo();
    if (c) pushToast(`Redid: ${c.label}`);
  }
  function archiveOne(id: string) {
    void archiveProject(id).then(() => refetch());
    record(
      "Archive project",
      () => void restoreProject(id).then(() => refetch()),
      () => void archiveProject(id).then(() => refetch()),
    );
  }

  function applyRename(p: Project, name: string) {
    const trimmed = name.trim();
    setRenamingId(null);
    if (!trimmed || trimmed === projectName(p)) return;
    const prev = projectName(p);
    setNameOverrides(o => ({ ...o, [p.id]: trimmed }));
    void renameProject(p.id, trimmed).then(() => refetch()).catch(() => {
      setNameOverrides(o => ({ ...o, [p.id]: prev }));
      void refetch();
    });
  }

  // Permanent delete — irreversible, so no undo; the confirm modal is the guard.
  async function deleteOne(p: Project) {
    if (
      !(await confirm({
        title: `Delete “${projectName(p)}”?`,
        description:
          "This permanently deletes the project and all of its deliverables, versions, library files, tasks, and history. This can't be undone.",
        confirmLabel: "Delete permanently",
        danger: true,
      }))
    )
      return;
    setSelected(s => {
      const n = new Set(s);
      n.delete(p.id);
      return n;
    });
    void deleteProject(p.id).then(() => refetch());
    pushToast(`Deleted “${projectName(p)}”`);
  }

  function setStatusRaw(id: string, status: ProjectStatus, fallback: ProjectStatus) {
    setStatusOverrides(o => ({ ...o, [id]: status }));
    void setProjectStatus(id, status).catch(() => {
      // server-side gate (or any failure) — revert the optimistic move
      setStatusOverrides(o => ({ ...o, [id]: fallback }));
      void refetch();
    });
  }
  function applyProjectStatus(p: Project, next: ProjectStatus) {
    const prev = projectStatus(p);
    if (next === prev) return;
    setStatusRaw(p.id, next, prev);
    record(
      "Change project status",
      () => setStatusRaw(p.id, prev, next),
      () => setStatusRaw(p.id, next, prev),
    );
  }

  // Conflict prompts (advancing a project past unfinished tasks). One instance;
  // the modal is rendered once at the bottom of the page.
  const conflict = createStatusConfirm();
  async function moveProject(
    p: Project,
    current: ProjectStatus,
    target: ProjectStatus,
    counts: TaskCounts,
  ) {
    if (target === current) return;
    // Backward / satisfied moves apply straight away.
    if (canSetStatus(current, target, counts)) {
      applyProjectStatus(p, target);
      return;
    }
    // Otherwise list the tasks that aren't at the target yet and confirm a
    // cascade — the server gate would reject the project move until they are.
    let tasks: Task[] = [];
    try {
      tasks = await listProjectTasks(p.id);
    } catch {
      /* fall back to an empty list — the confirm still explains the cascade */
    }
    const incomplete = tasks.filter(t => rank(t.status) < rank(target));
    const label = TASK_STATUS_META[target].label;
    const n = incomplete.length;
    const ok = await conflict.confirm({
      title: `Move project to ${label}?`,
      description:
        n === 0
          ? `Mark this project ${label}?`
          : `${n} task${n === 1 ? "" : "s"} ${n === 1 ? "isn't" : "aren't"} ${label} yet. Mark ${n === 1 ? "it" : "them all"} ${label} and advance the project?`,
      tasks: incomplete.map(t => ({ id: t.id, title: t.title, status: t.status })),
      confirmLabel: n === 0 ? "Confirm" : `Mark all ${label}`,
    });
    if (!ok) return;
    await Promise.all(incomplete.map(t => updateTask(t.id, { status: target })));
    applyProjectStatus(p, target);
    void refetch();
  }
  // Compact review-status rollup for the card — only non-zero statuses.
  const statusRollup = (p: Project) =>
    (
      [
        { key: "in_review", label: "in review", dot: "bg-sky-500" },
        { key: "revisions_requested", label: "revisions", dot: "bg-amber-500" },
        { key: "approved", label: "approved", dot: "bg-emerald-500" },
      ] as const
    )
      .map(s => ({ ...s, count: p.statusCounts?.[s.key] ?? 0 }))
      .filter(s => s.count > 0);
  function setTagsRaw(id: string, tags: Tag[]) {
    setTagOverrides(o => ({ ...o, [id]: tags }));
    void setProjectTags(id, tags.map(t => t.id));
  }
  function applyProjectTags(p: Project, next: Tag[]) {
    const prev = projectTags(p);
    setTagsRaw(p.id, next);
    record("Update tags", () => setTagsRaw(p.id, prev), () => setTagsRaw(p.id, next));
  }
  async function makeTag(name: string, color: TagColor): Promise<Tag> {
    const t = await createTag(name, color);
    await refetchTags();
    return t;
  }
  // initial tags for the create-project form
  const [formTags, setFormTags] = createSignal<Tag[]>([]);

  // ---- sorting + tag filtering ----
  type SortMode = "newest" | "oldest" | "name" | "tag" | "status";
  const SORT_OPTIONS: { value: SortMode; label: string }[] = [
    { value: "newest", label: "Newest" },
    { value: "oldest", label: "Oldest" },
    { value: "name", label: "Name A–Z" },
    { value: "tag", label: "By tag" },
    { value: "status", label: "By status" },
  ];
  // View/sort prefs persist per-browser (localStorage) so they survive reload.
  const [sortMode, setSortMode] = createSignal<SortMode>(getPref("cruio_projects_sort", "newest") as SortMode);
  const [tagFilter, setTagFilter] = createSignal<Set<string>>(new Set());
  const [search, setSearch] = createSignal("");
  type GroupMode = "none" | "entity" | "tag" | "status";
  const GROUP_OPTIONS: { value: GroupMode; label: string }[] = [
    { value: "none", label: "None" },
    { value: "entity", label: "Entity" },
    { value: "tag", label: "Tag" },
    { value: "status", label: "Status" },
  ];
  const [groupMode, setGroupMode] = createSignal<GroupMode>(getPref("cruio_projects_group", "none") as GroupMode);
  type ViewMode = "grid" | "list";
  const [view, setView] = createSignal<ViewMode>(getPref("cruio_projects_view", "grid") as ViewMode);
  const [hideDone, setHideDone] = createSignal(getBoolPref("cruio_projects_hidedone"));
  createEffect(() => setPref("cruio_projects_sort", sortMode()));
  createEffect(() => setPref("cruio_projects_group", groupMode()));
  createEffect(() => setPref("cruio_projects_view", view()));
  createEffect(() => setBoolPref("cruio_projects_hidedone", hideDone()));
  // collapsible group sections (parity with the Tasks screen)
  const [collapsed, setCollapsed] = createSignal<Set<string>>(new Set());
  function toggleCollapsed(key: string) {
    setCollapsed(s => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }
  function toggleTagFilter(id: string) {
    setTagFilter(s => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  // Entity scope + tag filter + sort, all applied client-side over the list.
  const filteredProjects = createMemo(() => {
    let list = projects() ?? [];
    const sel = scope.entity();
    if (sel) list = list.filter(p => p.entityId === sel.id);
    const tf = tagFilter();
    if (tf.size > 0) list = list.filter(p => projectTags(p).some(t => tf.has(t.id)));
    const q = search().trim().toLowerCase();
    if (q) list = list.filter(p => p.name.toLowerCase().includes(q));
    if (hideDone()) list = list.filter(p => projectStatus(p) !== "done");
    const mode = sortMode();
    const sorted = [...list];
    sorted.sort((a, b) => {
      if (mode === "newest") return b.createdAt - a.createdAt;
      if (mode === "oldest") return a.createdAt - b.createdAt;
      if (mode === "name") return a.name.localeCompare(b.name);
      // by lifecycle status (To do → Done), newest first within a status
      if (mode === "status")
        return rank(projectStatus(a)) - rank(projectStatus(b)) || b.createdAt - a.createdAt;
      // by first tag name, untagged last
      const at = projectTags(a)[0]?.name ?? "￿";
      const bt = projectTags(b)[0]?.name ?? "￿";
      return at.localeCompare(bt) || b.createdAt - a.createdAt;
    });
    return sorted;
  });

  // Optional grouping of the (already filtered + sorted) list. "none" yields a
  // single unlabeled group so the render path is uniform. Grouping by entity is
  // most useful under the "All Entities" scope.
  const projectGroups = createMemo(() => {
    const list = filteredProjects();
    const mode = groupMode();
    // flat list when ungrouped, or when entity-grouping is moot under a scope
    if (mode === "none" || (mode === "entity" && scope.entity()))
      return [{ key: "all", label: "", projects: list }];
    const buckets = new Map<string, { key: string; label: string; projects: Project[] }>();
    const push = (key: string, label: string, p: Project) => {
      if (!buckets.has(key)) buckets.set(key, { key, label, projects: [] });
      buckets.get(key)!.projects.push(p);
    };
    for (const p of list) {
      if (mode === "entity") push(p.entityId ?? "none", p.entityName ?? "No entity", p);
      else if (mode === "status") {
        const s = projectStatus(p);
        push(`status:${s}`, PROJECT_STATUS_META[s].label, p);
      } else {
        const first = projectTags(p)[0];
        if (first) push(`tag:${first.id}`, first.name, p);
        else push("untagged", "Untagged", p);
      }
    }
    // status sections follow the lifecycle order; others sort by label with
    // the catch-all bucket ("No entity"/"Untagged") pinned last.
    if (mode === "status") {
      return [...buckets.values()].sort(
        (a, b) => rank(a.key.slice(7) as ProjectStatus) - rank(b.key.slice(7) as ProjectStatus),
      );
    }
    const isCatchAll = (k: string) => k === "none" || k === "untagged";
    return [...buckets.values()].sort((a, b) => {
      const ac = isCatchAll(a.key);
      const bc = isCatchAll(b.key);
      if (ac !== bc) return ac ? 1 : -1;
      return a.label.localeCompare(b.label);
    });
  });

  const [creating, setCreating] = createSignal(false);
  let createFormRef!: HTMLFormElement;
  let newProjectBtnRef!: HTMLButtonElement;
  // entity picked in the create-project form ("", entity id, or "__new")
  const [formEntity, setFormEntity] = createSignal("");
  const [ctxMenu, setCtxMenu] = createSignal<MenuState | null>(null);
  const [selected, setSelected] = createSignal<Set<string>>(new Set());

  function toggleSelect(id: string) {
    setSelected(s => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  // Single click selects a project, double click opens it. A short timer lets a
  // double click cancel the pending single-click select. Clicks on inner controls
  // (checkbox, kebab, tag menu, links) are ignored so they keep their own behavior.
  let cardClickTimer: ReturnType<typeof setTimeout> | undefined;
  const isInnerControl = (e: MouseEvent) =>
    !!(e.target as HTMLElement).closest("button, a, input, [data-no-nav]");
  function onProjectClick(p: Project, e: MouseEvent) {
    if (isInnerControl(e)) return;
    clearTimeout(cardClickTimer);
    cardClickTimer = setTimeout(() => toggleSelect(p.id), 200);
  }
  function onProjectDblClick(p: Project, e: MouseEvent) {
    if (isInnerControl(e)) return;
    clearTimeout(cardClickTimer);
    navigate(`/p/${p.id}`);
  }
  const clearSelection = () => setSelected(new Set<string>());

  // Lift the toast stack above the bottom bulk-action bar while selecting.
  createEffect(() => setToastRaised(selected().size > 0));
  onCleanup(() => setToastRaised(false));

  async function bulkArchive() {
    const ids = selected();
    if (
      !(await confirm({
        title: `Archive ${ids.size} project${ids.size === 1 ? "" : "s"}?`,
        description: "You can restore them from the Archived section.",
        confirmLabel: "Archive",
      }))
    )
      return;
    for (const id of ids) archiveOne(id);
    clearSelection();
  }

  function openProjectMenu(p: Project, x: number, y: number) {
    setCtxMenu({
      x,
      y,
      entries: [
        {
          label: "Open",
          icon: "iconoir:open-in-window",
          hint: "↵",
          run: () => navigate(`/p/${p.id}`),
        },
        ...(isAdmin()
          ? [
              {
                label: "Rename",
                icon: "iconoir:edit-pencil",
                run: () => setRenamingId(p.id),
              },
              { separator: true } as const,
              {
                label: "Archive project",
                icon: "iconoir:archive",
                run: async () => {
                  if (
                    !(await confirm({
                      title: `Archive “${projectName(p)}”?`,
                      description: "You can restore it from the Archived section.",
                      confirmLabel: "Archive",
                    }))
                  )
                    return;
                  archiveOne(p.id);
                },
              },
              {
                label: "Delete project",
                icon: "iconoir:trash",
                danger: true,
                run: () => void deleteOne(p),
              },
            ]
          : []),
      ],
    });
  }

  const { myRole, isAdmin } = useViewerRole(user, orgs);

  // n = new project (unless typing somewhere) — mirrors the Tasks page's N shortcut
  onMount(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const typing =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        if (typing) return;
        e.preventDefault();
        if (e.shiftKey) doRedo();
        else doUndo();
        return;
      }
      if (typing) return;
      if (e.key === "n" && !e.metaKey && !e.ctrlKey && !e.altKey && isAdmin()) {
        e.preventDefault();
        setCreating(true);
      }
    }
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  // close the create-project form on an outside click or Escape
  createEffect(() => {
    if (!creating()) return;
    function onDocPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (createFormRef?.contains(target) || newProjectBtnRef?.contains(target)) return;
      setCreating(false);
    }
    function onDocKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setCreating(false);
    }
    document.addEventListener("pointerdown", onDocPointerDown);
    document.addEventListener("keydown", onDocKeyDown);
    onCleanup(() => {
      document.removeEventListener("pointerdown", onDocPointerDown);
      document.removeEventListener("keydown", onDocKeyDown);
    });
  });

  // no org yet → onboarding; org exists but none active → activate the first
  createEffect(() => {
    const u = user();
    const o = orgs();
    if (!u || !o) return;
    if (o.length === 0) {
      navigate("/onboarding", { replace: true });
    } else if (!o.some((x) => x.id === u.activeOrganizationId)) {
      void authClient.organization
        .setActive({ organizationId: o[0].id })
        .then(async () => {
          await revalidate([requireUserQuery.key, sessionQuery.key, myOrgsQuery.key]);
          await refetch();
        });
    }
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const name = (
      form.elements.namedItem("name") as HTMLInputElement
    ).value.trim();
    if (!name) return;
    const activeEntity = scope.entity();
    let entityId: string | null = activeEntity ? activeEntity.id : formEntity() || null;
    if (!activeEntity && formEntity() === "__new") {
      const newName = (
        form.elements.namedItem("newEntity") as HTMLInputElement
      ).value.trim();
      entityId = newName ? (await createEntity(newName)).id : null;
      void refetchEntities();
    }
    const id = newId();
    await createProject(id, name, entityId);
    if (formTags().length) await setProjectTags(id, formTags().map(t => t.id));
    navigate(`/p/${id}`);
  }

  const selectBox = (p: Project, cls: string) => (
    <Show when={isAdmin()}>
      <button
        class={`w-4 h-4 rounded border flex items-center justify-center cursor-pointer bg-panel/90 ${cls}`}
        classList={{
          "border-neutral-300 opacity-0 group-hover:opacity-100": !selected().has(p.id),
          "border-sky-500 bg-sky-500 text-white opacity-100": selected().has(p.id),
        }}
        title="Select"
        onClick={(e) => {
          e.stopPropagation();
          toggleSelect(p.id);
        }}
      >
        <Show when={selected().has(p.id)}>
          <Icon icon="iconoir:check" width="10" />
        </Show>
      </button>
    </Show>
  );

  const statusRollupRow = (p: Project) => (
    <div class="flex items-center gap-2 flex-wrap text-[11px] text-neutral-400">
      <Show
        when={statusRollup(p).length > 0}
        fallback={<span>{p.deliverableCount ? "No reviews yet" : "No deliverables yet"}</span>}
      >
        <For each={statusRollup(p)}>
          {(s) => (
            <span class="flex items-center gap-1 text-neutral-500">
              <span class={`size-1.5 rounded-full ${s.dot}`} />
              {s.count} {s.label}
            </span>
          )}
        </For>
      </Show>
    </div>
  );

  // Overall project status pill. Read-only for non-admins; for admins it's a
  // picker whose forward options are gated by the project's tasks (a project
  // can only advance into a status once all its tasks have reached it).
  const statusPill = (p: Project) => {
    const st = () => projectStatus(p);
    const counts = () => p.taskCounts ?? { todo: 0, in_progress: 0, done: 0 };
    // Same control tasks use. Advancing past unfinished tasks isn't disabled —
    // it opens a conflict modal that offers to cascade the tasks (moveProject).
    return (
      <StatusControl
        status={st()}
        onSelect={(opt) => void moveProject(p, st(), opt, counts())}
        disabled={!isAdmin()}
        variant="chip"
        portal
        stopPropagation
      />
    );
  };

  const menuButton = (p: Project) => (
    <button
      class="p-0.5 rounded text-neutral-300 opacity-0 group-hover:opacity-100 hover:text-neutral-600 hover:bg-neutral-100 cursor-pointer"
      title="Project actions"
      onClick={(e) => {
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        openProjectMenu(p, r.left, r.bottom + 4);
      }}
    >
      <Icon icon="iconoir:more-horiz" width="14" />
    </button>
  );

  const tagArea = (p: Project) => (
    <Show when={isAdmin()}>
      <div
        classList={{
          "opacity-100": projectTags(p).length === 0,
          "opacity-0 group-hover:opacity-100 transition-opacity": projectTags(p).length > 0,
        }}
      >
        <TagPicker
          selected={projectTags(p)}
          allTags={tagsList() ?? []}
          onChange={next => applyProjectTags(p, next)}
          onCreateTag={makeTag}
          canManage={true}
          portal
          align="right"
        />
      </div>
    </Show>
  );

  const projectCard = (p: Project) => (
    <div
      data-selectable
      class="group text-left border rounded-lg bg-panel overflow-hidden hover:shadow-sm transition-all cursor-pointer"
      classList={{
        "border-sky-500 ring-2 ring-sky-500": selected().has(p.id),
        "border-neutral-200 hover:border-neutral-300": !selected().has(p.id),
      }}
      onClick={(e) => onProjectClick(p, e)}
      onDblClick={(e) => onProjectDblClick(p, e)}
      onContextMenu={(e) => {
        e.preventDefault();
        openProjectMenu(p, e.clientX, e.clientY);
      }}
    >
      {/* cover — most recent version image across the project */}
      <div class="relative aspect-video bg-neutral-50 flex items-center justify-center border-b border-neutral-100 overflow-hidden">
        <Show
          when={p.cover}
          fallback={<Icon icon="iconoir:media-image" width="26" class="text-neutral-300" />}
        >
          <img src={fileUrl(p.cover!)} alt="" class="w-full h-full object-cover" draggable={false} />
        </Show>
        {selectBox(p, "absolute top-2 left-2")}
      </div>

      <div class="p-3.5">
        <div class="flex items-center justify-between gap-2">
          <Show
            when={renamingId() === p.id}
            fallback={
              <span
                class="text-sm font-medium text-neutral-800 truncate min-w-0"
                onDblClick={(e) => {
                  e.stopPropagation();
                  if (isAdmin()) setRenamingId(p.id);
                }}
              >
                {projectName(p)}
              </span>
            }
          >
            <input
              class="text-sm font-medium text-neutral-800 min-w-0 flex-1 bg-panel border border-sky-400 rounded px-1 py-0.5 outline-none"
              value={projectName(p)}
              ref={(el) => queueMicrotask(() => { el.focus(); el.select(); })}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onDblClick={(e) => e.stopPropagation()}
              onBlur={(e) => applyRename(p, e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
                else if (e.key === "Escape") { e.preventDefault(); setRenamingId(null); }
              }}
            />
          </Show>
          <div class="flex items-center gap-1.5 shrink-0">
            {/* entity chip is redundant once scoped into that entity */}
            <Show when={!scope.entity() && groupMode() !== "entity" && p.entityName}>
              <span class="bg-muted text-neutral-500 text-xs py-0.5 px-1.5 rounded truncate max-w-28">
                {p.entityName}
              </span>
            </Show>
            {menuButton(p)}
          </div>
        </div>

        {/* overall project status (task-gated) */}
        <div class="mt-2">{statusPill(p)}</div>

        {/* asset count + review-status rollup — the card's bottom label */}
        <div class="mt-1.5 flex items-center gap-2 flex-wrap text-[11px] text-neutral-400">
          <span class="flex items-center gap-1 shrink-0 text-neutral-500">
            <Icon icon="iconoir:media-image-list" width="11" />
            {p.deliverableCount ?? 0} asset{(p.deliverableCount ?? 0) === 1 ? "" : "s"}
          </span>
          <Show when={statusRollup(p).length > 0}>
            <span class="text-neutral-300">·</span>
            <For each={statusRollup(p)}>
              {(s) => (
                <span class="flex items-center gap-1 text-neutral-500">
                  <span class={`size-1.5 rounded-full ${s.dot}`} />
                  {s.count} {s.label}
                </span>
              )}
            </For>
          </Show>
        </div>

        <div class="mt-2.5 flex items-center gap-1.5 flex-wrap">
          <TagChips tags={projectTags(p)} />
          {tagArea(p)}
        </div>
      </div>
    </div>
  );

  const projectRow = (p: Project) => (
    <div
      data-selectable
      class="group flex items-center gap-3 px-3 py-2.5 hover:bg-neutral-50 cursor-pointer"
      classList={{ "bg-accent-sky": selected().has(p.id) }}
      onClick={(e) => onProjectClick(p, e)}
      onDblClick={(e) => onProjectDblClick(p, e)}
      onContextMenu={(e) => {
        e.preventDefault();
        openProjectMenu(p, e.clientX, e.clientY);
      }}
    >
      {selectBox(p, "shrink-0")}
      <div class="relative w-14 h-9 shrink-0 rounded bg-neutral-50 border border-neutral-100 overflow-hidden hidden sm:flex items-center justify-center">
        <Show
          when={p.cover}
          fallback={<Icon icon="iconoir:media-image" width="16" class="text-neutral-300" />}
        >
          <img src={fileUrl(p.cover!)} alt="" class="w-full h-full object-cover" draggable={false} />
        </Show>
      </div>
      <Show
        when={renamingId() === p.id}
        fallback={
          <span
            class="text-sm font-medium text-neutral-800 truncate min-w-0 flex-1 sm:flex-none sm:w-48"
            onDblClick={(e) => {
              e.stopPropagation();
              if (isAdmin()) setRenamingId(p.id);
            }}
          >
            {projectName(p)}
          </span>
        }
      >
        <input
          class="text-sm font-medium text-neutral-800 min-w-0 flex-1 sm:flex-none sm:w-48 bg-panel border border-sky-400 rounded px-1 py-0.5 outline-none"
          value={projectName(p)}
          ref={(el) => queueMicrotask(() => { el.focus(); el.select(); })}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onDblClick={(e) => e.stopPropagation()}
          onBlur={(e) => applyRename(p, e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
            else if (e.key === "Escape") { e.preventDefault(); setRenamingId(null); }
          }}
        />
      </Show>
      <span class="shrink-0 hidden sm:flex items-center gap-1 text-[11px] text-neutral-400">
        <Icon icon="iconoir:media-image-list" width="12" />
        {p.deliverableCount ?? 0}
      </span>
      <div class="shrink-0">{statusPill(p)}</div>
      <div class="flex-1 min-w-0">{statusRollupRow(p)}</div>
      <div class="hidden md:flex items-center gap-1.5 flex-wrap justify-end max-w-64">
        <TagChips tags={projectTags(p)} />
        {tagArea(p)}
      </div>
      <Show when={!scope.entity() && groupMode() !== "entity" && p.entityName}>
        <span class="hidden sm:inline-block shrink-0 bg-muted text-neutral-500 text-xs py-0.5 px-1.5 rounded truncate max-w-28">
          {p.entityName}
        </span>
      </Show>
      {menuButton(p)}
    </div>
  );

  return (
    <div class="p-1 h-full bg-canvas">
      <div class="rounded-lg overflow-clip w-full flex flex-col h-full border border-line">
        <AppNav
          onOrgSwitch={() => {
            void refetch();
            void refetchEntities();
          }}
        />

        <div class="shrink-0 px-4 sm:px-8 pt-8 pb-4 bg-canvas border-b border-line">
          <div class="w-full">
            <div class="flex items-center justify-between gap-2 mb-4">
              <div class="flex items-center gap-3 min-w-0">
              <EntityAvatar name={scope.entity()?.name || "•"} size={32} />
              <h1 class="text-lg font-semibold text-neutral-800 truncate">{scope.entity()?.name || "All"} Projects</h1>
              <Show when={isAdmin()}>
                <EntityOptions
                  entity={scope.entity()}
                  isAdmin={isAdmin()}
                  portal
                  align="left"
                  onChanged={() => {
                    void refetch();
                    void refetchEntities();
                  }}
                />
              </Show>
              </div>
              <Show when={isAdmin()}>
                <button
                  ref={newProjectBtnRef}
                  class="shrink-0 flex items-center gap-1 text-xs bg-brand text-on-brand rounded-md px-3 py-1.5 hover:bg-neutral-700 cursor-pointer"
                  onClick={() => setCreating((c) => !c)}
                >
                  <Icon icon="iconoir:plus" width="14" /> New project
                  <span class="text-[10px] text-neutral-400 bg-neutral-800 rounded px-1 ml-1">N</span>
                </button>
              </Show>
            </div>

            {/* sort + tag filter + search toolbar (shared with the Tasks screen) */}
            <FilterBar
              segmented={{
                value: view(),
                options: [
                  { value: "grid", label: "Grid", icon: "iconoir:view-grid" },
                  { value: "list", label: "List", icon: "iconoir:list" },
                ],
                onChange: v => setView(v as ViewMode),
              }}
              menus={[
                {
                  icon: "iconoir:view-grid",
                  label: "Group",
                  value: groupMode(),
                  // "Entity" only makes sense under the "All Entities" scope
                  options: scope.entity()
                    ? GROUP_OPTIONS.filter(o => o.value !== "entity")
                    : GROUP_OPTIONS,
                  onChange: v => setGroupMode(v as GroupMode),
                },
                {
                  icon: "iconoir:sort",
                  label: "Sort",
                  value: sortMode(),
                  options: SORT_OPTIONS,
                  onChange: v => setSortMode(v as SortMode),
                },
              ]}
              toggles={[
                {
                  label: "Hide done",
                  active: hideDone(),
                  onToggle: () => setHideDone(v => !v),
                },
              ]}
              tags={{
                all: tagsList() ?? [],
                selected: tagFilter(),
                onToggle: toggleTagFilter,
                onClear: () => setTagFilter(new Set()),
              }}
              search={{
                value: search(),
                onInput: setSearch,
                placeholder: "Filter projects…",
              }}
            />
          </div>
        </div>

        <main
          class="flex-1 overflow-y-auto px-4 sm:px-8 pt-5 pb-8"
          onClick={(e) => {
            // click on empty space (not a card/row) clears any selection
            if (selected().size && !(e.target as HTMLElement).closest("[data-selectable]"))
              clearSelection();
          }}
        >
          <div class="w-full">
            <Show when={creating()}>
              <form
                ref={createFormRef}
                onSubmit={submit}
                class="relative mb-6 p-4 border border-neutral-200 rounded-lg bg-panel flex flex-col sm:flex-row gap-3 sm:items-end"
              >
                <button
                  type="button"
                  class="absolute top-2 right-2 p-1 rounded text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 cursor-pointer"
                  title="Close (Esc)"
                  onClick={() => setCreating(false)}
                >
                  <Icon icon="iconoir:xmark" width="14" />
                </button>
                <label class="flex-1 text-xs text-neutral-500">
                  Project name
                  <input
                    name="name"
                    required
                    class="mt-1 w-full text-sm border border-neutral-200 rounded px-2 py-1.5 outline-none focus:border-sky-400"
                    placeholder="Spring lookbook"
                    ref={(el) => queueMicrotask(() => el.focus())}
                  />
                </label>
                <Show
                  when={!scope.entity()}
                  fallback={
                    <div class="flex-1 text-xs text-neutral-500">
                      Entity
                      <div class="mt-1 flex items-center h-[30px]">
                        <span class="bg-muted text-neutral-600 text-xs py-1 px-2 rounded">
                          {scope.entity()!.name}
                        </span>
                      </div>
                    </div>
                  }
                >
                  <label class="flex-1 text-xs text-neutral-500">
                    Entity
                    <select
                      class="mt-1 block w-full text-sm border border-neutral-200 rounded px-2 py-1.5 outline-none focus:border-sky-400 bg-panel"
                      onChange={(e) => setFormEntity(e.currentTarget.value)}
                    >
                      <option value="" selected={formEntity() === ""}>
                        No entity
                      </option>
                      <For each={entitiesList() ?? []}>
                        {(c) => (
                          <option value={c.id} selected={formEntity() === c.id}>
                            {c.name}
                          </option>
                        )}
                      </For>
                      <option value="__new" selected={formEntity() === "__new"}>
                        ＋ New entity…
                      </option>
                    </select>
                  </label>
                </Show>
                <Show when={!scope.entity() && formEntity() === "__new"}>
                  <label class="flex-1 text-xs text-neutral-500">
                    New entity name
                    <input
                      name="newEntity"
                      required
                      class="mt-1 w-full text-sm border border-neutral-200 rounded px-2 py-1.5 outline-none focus:border-sky-400"
                      placeholder="Client or department"
                      ref={(el) => queueMicrotask(() => el.focus())}
                    />
                  </label>
                </Show>
                <div class="flex-1 text-xs text-neutral-500">
                  Tags
                  <div class="mt-1 flex items-center gap-1.5 flex-wrap min-h-[30px]">
                    <TagChips tags={formTags()} size="sm" onRemove={t => setFormTags(formTags().filter(x => x.id !== t.id))} />
                    <TagPicker
                      selected={formTags()}
                      allTags={tagsList() ?? []}
                      onChange={setFormTags}
                      onCreateTag={makeTag}
                      canManage={true}
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  class="text-xs bg-brand text-on-brand rounded px-3 py-2 hover:bg-neutral-700 cursor-pointer"
                >
                  Create
                </button>
              </form>
            </Show>

            <Show
              when={(filteredProjects() ?? []).length > 0}
              fallback={
                <Show when={!projects.loading}>
                  <div class="flex flex-col items-center justify-center text-center py-20">
                    <div class="flex items-center justify-center size-12 rounded-full bg-muted text-neutral-400 mb-3">
                      <Icon icon="iconoir:folder" width="24" />
                    </div>
                    <h2 class="text-sm font-medium text-neutral-700">No projects yet</h2>
                    <p class="text-xs text-neutral-400 mt-1 max-w-xs">
                      {isAdmin()
                        ? "Projects hold your deliverables and their review rounds. Create your first one to open its canvas."
                        : myRole() === "guest"
                          ? "Projects shared with you will appear here."
                          : "Projects in your studio will appear here."}
                    </p>
                    <Show when={isAdmin()}>
                      <button
                        class="mt-4 flex items-center gap-1 text-xs bg-brand text-on-brand rounded-md px-3 py-1.5 hover:bg-neutral-700 cursor-pointer"
                        onClick={() => setCreating(true)}
                      >
                        <Icon icon="iconoir:plus" width="14" /> New project
                      </button>
                    </Show>
                  </div>
                </Show>
              }
            >
              <div class="space-y-6">
                <For each={projectGroups()}>
                  {(g) => (
                    <div>
                      <Show when={g.label}>
                        <div class="flex items-center gap-2 mb-2">
                          <button
                            class="cursor-pointer text-neutral-400 hover:text-neutral-600"
                            onClick={() => toggleCollapsed(`${groupMode()}:${g.key}`)}
                          >
                            <Icon
                              icon="iconoir:nav-arrow-down"
                              width="12"
                              class={collapsed().has(`${groupMode()}:${g.key}`) ? "-rotate-90" : ""}
                            />
                          </button>
                          <h2 class="text-xs font-semibold text-neutral-400 uppercase tracking-wide">
                            {g.label}
                          </h2>
                          <span class="text-[10px] text-neutral-400">{g.projects.length}</span>
                        </div>
                      </Show>
                      <Show when={!collapsed().has(`${groupMode()}:${g.key}`)}>
                        <Show
                          when={view() === "grid"}
                          fallback={
                            <div class="border border-neutral-200 rounded-lg bg-panel divide-y divide-neutral-100 overflow-hidden">
                              <For each={g.projects}>{projectRow}</For>
                            </div>
                          }
                        >
                          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                            <For each={g.projects}>{projectCard}</For>
                          </div>
                        </Show>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </main>

        <AppFooter
          start={
            <span class="flex items-center gap-1.5 text-neutral-500 truncate">
              <span class="font-medium">
                {filteredProjects().length} project{filteredProjects().length === 1 ? "" : "s"}
              </span>
              <Show when={!scope.entity() && (entitiesList()?.length ?? 0) > 0}>
                <span class="text-neutral-400">
                  · {entitiesList()!.length} entit{entitiesList()!.length === 1 ? "y" : "ies"}
                </span>
              </Show>
            </span>
          }
        />
      </div>
      <ContextMenu state={ctxMenu()} onClose={() => setCtxMenu(null)} />
      <StatusConflictModal
        open={!!conflict.state()}
        title={conflict.state()?.title ?? ""}
        description={conflict.state()?.description ?? ""}
        tasks={conflict.state()?.tasks ?? []}
        confirmLabel={conflict.state()?.confirmLabel ?? "Confirm"}
        onConfirm={() => conflict.settle(true)}
        onCancel={() => conflict.settle(false)}
      />
      <Show when={selected().size > 0}>
        <div class="fixed bottom-16 sm:bottom-5 left-1/2 -translate-x-1/2 z-30 flex flex-wrap items-center justify-center gap-1.5 max-w-[95vw] bg-brand text-on-brand rounded-lg shadow-2xl px-3 py-2 text-xs">
          <span class="px-2 font-medium">{selected().size} selected</span>
          <button
            class="flex items-center gap-1 px-2 py-1 rounded hover:bg-panel/10 cursor-pointer"
            onClick={() => void bulkArchive()}
          >
            <Icon icon="iconoir:archive" width="13" /> Archive
          </button>
          <button
            class="p-1 rounded hover:bg-panel/10 cursor-pointer"
            title="Clear selection"
            onClick={clearSelection}
          >
            <Icon icon="iconoir:xmark" width="13" />
          </button>
        </div>
      </Show>
    </div>
  );
  //test
}
