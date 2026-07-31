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
import { NavMenu } from "../components/NavMenu";
import { A, createAsync, revalidate, useNavigate } from "@solidjs/router";
import { Icon } from "@iconify-icon/solid";
import { archiveProject, createProject, listProjects } from "../lib/api";
import {
  createEntity,
  listEntities,
  myOrgsQuery,
  requireUserQuery,
  sessionQuery,
} from "../lib/org-api";
import { authClient } from "../lib/auth-client";
import { useViewerRole } from "../lib/viewer";
import { newId } from "../lib/id";
import { EntityAvatar } from "../components/Avatar";
import { AppNav } from "../components/AppNav";
import { AppFooter } from "../components/AppFooter";
import { useScope } from "../components/ScopeProvider";
import { ContextMenu, type MenuState } from "../components/ContextMenu";
import { EntityOptions } from "../components/EntityOptions";
import { TagChips, TAG_COLORS } from "../components/TagChips";
import { TagPicker } from "../components/TagPicker";
import { createTag, listTags, setProjectTags } from "../lib/tag-api";
import { fileUrl } from "../lib/types";
import type { Project, Tag, TagColor } from "../lib/types";

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
  // Optimistic overlay so toggling a project's tags stays responsive without a
  // full project refetch (which would remount the card and close the picker).
  const [tagOverrides, setTagOverrides] = createSignal<Record<string, Tag[]>>({});
  const projectTags = (p: Project) => tagOverrides()[p.id] ?? p.tags ?? [];
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
  function applyProjectTags(p: Project, next: Tag[]) {
    setTagOverrides(o => ({ ...o, [p.id]: next }));
    void setProjectTags(p.id, next.map(t => t.id));
  }
  async function makeTag(name: string, color: TagColor): Promise<Tag> {
    const t = await createTag(name, color);
    await refetchTags();
    return t;
  }
  // initial tags for the create-project form
  const [formTags, setFormTags] = createSignal<Tag[]>([]);

  // ---- sorting + tag filtering ----
  type SortMode = "newest" | "oldest" | "name" | "tag";
  const SORT_OPTIONS: { value: SortMode; label: string }[] = [
    { value: "newest", label: "Newest" },
    { value: "oldest", label: "Oldest" },
    { value: "name", label: "Name A–Z" },
    { value: "tag", label: "By tag" },
  ];
  const [sortMode, setSortMode] = createSignal<SortMode>("newest");
  const [tagFilter, setTagFilter] = createSignal<Set<string>>(new Set());
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
    const mode = sortMode();
    const sorted = [...list];
    sorted.sort((a, b) => {
      if (mode === "newest") return b.createdAt - a.createdAt;
      if (mode === "oldest") return a.createdAt - b.createdAt;
      if (mode === "name") return a.name.localeCompare(b.name);
      // by first tag name, untagged last
      const at = projectTags(a)[0]?.name ?? "￿";
      const bt = projectTags(b)[0]?.name ?? "￿";
      return at.localeCompare(bt) || b.createdAt - a.createdAt;
    });
    return sorted;
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
  const clearSelection = () => setSelected(new Set<string>());

  async function bulkArchive() {
    const ids = selected();
    if (!window.confirm(`Archive ${ids.size} project${ids.size === 1 ? "" : "s"}? You can restore them from the Archived section.`)) return;
    for (const id of ids) await archiveProject(id);
    clearSelection();
    void refetch();
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
              { separator: true } as const,
              {
                label: "Archive project",
                icon: "iconoir:archive",
                danger: true,
                run: () => {
                  if (
                    !window.confirm(
                      `Archive ${p.name}? You can restore it from the Archived section.`,
                    )
                  )
                    return;
                  void archiveProject(p.id).then(() => {
                    void refetch();
                  });
                },
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

  return (
    <div class="p-1 h-screen bg-[#fffefe]">
      <div class="rounded-lg overflow-clip w-full flex flex-col h-full border border-[#eceaea]">
        <AppNav
          onOrgSwitch={() => {
            void refetch();
            void refetchEntities();
          }}
        />

        <main class="flex-1 overflow-y-auto p-8">
          <div class="max-w-4xl mx-auto">
            <div class="flex items-center justify-between mb-6">
              <div class="flex items-center gap-3">
              <EntityAvatar name={scope.entity()?.name || "•"} size={32} />
              <h1 class="text-lg font-semibold text-neutral-800">{scope.entity()?.name || "All"} Projects</h1>
              <Show when={isAdmin()}>
                <EntityOptions
                  entity={scope.entity()}
                  isAdmin={isAdmin()}
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
                  class="flex items-center gap-1 text-xs bg-neutral-900 text-white rounded-md px-3 py-1.5 hover:bg-neutral-700 cursor-pointer"
                  onClick={() => setCreating((c) => !c)}
                >
                  <Icon icon="iconoir:plus" width="14" /> New project
                  <span class="text-[10px] text-neutral-400 bg-neutral-800 rounded px-1 ml-1">N</span>
                </button>
              </Show>
            </div>

            {/* sort + tag filter toolbar */}
            <div class="flex items-center gap-2 mb-5 flex-wrap">
              <NavMenu
                panelClass="w-36"
                trigger={({ toggle }) => (
                  <button
                    class="flex items-center gap-1 text-[11px] text-neutral-500 hover:bg-neutral-100 rounded-md px-2 py-1.5 cursor-pointer"
                    onClick={toggle}
                  >
                    <Icon icon="iconoir:sort" width="13" />
                    Sort: {SORT_OPTIONS.find(o => o.value === sortMode())?.label}
                  </button>
                )}
              >
                {({ close }) => (
                  <div class="p-1">
                    <For each={SORT_OPTIONS}>
                      {o => (
                        <button
                          class="w-full flex items-center justify-between px-2 py-1.5 rounded text-left text-xs text-neutral-700 hover:bg-neutral-50 cursor-pointer"
                          onClick={() => {
                            close();
                            setSortMode(o.value);
                          }}
                        >
                          {o.label}
                          <Show when={sortMode() === o.value}>
                            <Icon icon="iconoir:check" width="12" class="text-neutral-400" />
                          </Show>
                        </button>
                      )}
                    </For>
                  </div>
                )}
              </NavMenu>

              <Show when={(tagsList() ?? []).length > 0}>
                <span class="w-px h-4 bg-neutral-200 shrink-0" />
                <div class="flex items-center gap-1 flex-wrap">
                  <For each={tagsList()}>
                    {t => (
                      <button
                        class={`inline-flex items-center gap-1 rounded-full text-[11px] font-medium px-2 py-0.5 cursor-pointer border ${
                          tagFilter().has(t.id)
                            ? `${TAG_COLORS[t.color].chip} border-transparent`
                            : "border-neutral-200 text-neutral-500 hover:bg-neutral-50"
                        }`}
                        onClick={() => toggleTagFilter(t.id)}
                      >
                        <span class={`size-1.5 rounded-full ${TAG_COLORS[t.color].dot}`} />
                        {t.name}
                      </button>
                    )}
                  </For>
                  <Show when={tagFilter().size > 0}>
                    <button
                      class="text-[11px] text-neutral-400 hover:text-neutral-700 px-1 cursor-pointer"
                      onClick={() => setTagFilter(new Set())}
                    >
                      Clear
                    </button>
                  </Show>
                </div>
              </Show>
            </div>

            <Show when={creating()}>
              <form
                ref={createFormRef}
                onSubmit={submit}
                class="relative mb-6 p-4 border border-neutral-200 rounded-lg bg-white flex gap-3 items-end"
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
                        <span class="bg-[#efeded] text-neutral-600 text-xs py-1 px-2 rounded">
                          {scope.entity()!.name}
                        </span>
                      </div>
                    </div>
                  }
                >
                  <label class="flex-1 text-xs text-neutral-500">
                    Entity
                    <select
                      class="mt-1 block w-full text-sm border border-neutral-200 rounded px-2 py-1.5 outline-none focus:border-sky-400 bg-white"
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
                  class="text-xs bg-neutral-900 text-white rounded px-3 py-2 hover:bg-neutral-700 cursor-pointer"
                >
                  Create
                </button>
              </form>
            </Show>

            <Show
              when={(filteredProjects() ?? []).length > 0}
              fallback={
                <Show when={!projects.loading}>
                  <div class="text-center py-20 text-neutral-400">
                    <Icon icon="iconoir:folder" width="36" />
                    <p class="mt-3 text-sm text-neutral-500 font-medium">
                      No projects yet
                    </p>
                    <p class="mt-1 text-xs">
                      {isAdmin()
                        ? "Create your first project to open its canvas."
                        : myRole() === "guest"
                          ? "Projects shared with you will appear here."
                          : "Projects in your studio will appear here."}
                    </p>
                  </div>
                </Show>
              }
            >
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <For each={filteredProjects()}>
                  {(p) => (
                    <div
                      class="group text-left border rounded-lg bg-white overflow-hidden hover:shadow-sm transition-all cursor-pointer"
                      classList={{
                        "border-sky-500 ring-2 ring-sky-500": selected().has(p.id),
                        "border-neutral-200 hover:border-neutral-300": !selected().has(p.id),
                      }}
                      onClick={() => navigate(`/p/${p.id}`)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        openProjectMenu(p, e.clientX, e.clientY);
                      }}
                    >
                      {/* cover — most recent version image across the project */}
                      <div class="relative aspect-video bg-neutral-50 flex items-center justify-center border-b border-neutral-100 overflow-hidden">
                        <Show
                          when={p.cover}
                          fallback={
                            <Icon icon="iconoir:media-image" width="26" class="text-neutral-300" />
                          }
                        >
                          <img
                            src={fileUrl(p.cover!)}
                            alt=""
                            class="w-full h-full object-cover"
                            draggable={false}
                          />
                        </Show>
                        <span class="absolute bottom-2 left-2 flex items-center gap-1 bg-black/55 text-white text-[10px] px-1.5 py-0.5 rounded-full backdrop-blur-sm">
                          <Icon icon="iconoir:media-image-list" width="11" />
                          {p.deliverableCount ?? 0}
                        </span>
                        <Show when={isAdmin()}>
                          <button
                            class="absolute top-2 left-2 w-4 h-4 rounded border flex items-center justify-center cursor-pointer bg-white/90"
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
                      </div>

                      <div class="p-3.5">
                        <div class="flex items-center justify-between gap-2">
                          <span class="text-sm font-medium text-neutral-800 truncate min-w-0">
                            {p.name}
                          </span>
                          <div class="flex items-center gap-1.5 shrink-0">
                            {/* entity chip is redundant once scoped into that entity */}
                            <Show when={!scope.entity() && p.entityName}>
                              <span class="bg-[#efeded] text-neutral-500 text-xs py-0.5 px-1.5 rounded truncate max-w-28">
                                {p.entityName}
                              </span>
                            </Show>
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
                          </div>
                        </div>

                        {/* review-status rollup across the project's deliverables */}
                        <div class="mt-1.5 flex items-center gap-2 flex-wrap text-[11px] text-neutral-400">
                          <Show
                            when={statusRollup(p).length > 0}
                            fallback={
                              <span>
                                {p.deliverableCount ? "No reviews yet" : "No deliverables yet"}
                              </span>
                            }
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

                        <div class="mt-2.5 flex items-center gap-1.5 flex-wrap">
                          <TagChips tags={projectTags(p)} />
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
                              />
                            </div>
                          </Show>
                        </div>
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
      <ContextMenu state={ctxMenu()} onClose={() => setCtxMenu(null)} />
      <Show when={selected().size > 0}>
        <div class="fixed bottom-5 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 bg-neutral-900 text-white rounded-lg shadow-2xl px-3 py-2 text-xs">
          <span class="px-2 font-medium">{selected().size} selected</span>
          <button
            class="flex items-center gap-1 px-2 py-1 rounded hover:bg-white/10 cursor-pointer"
            onClick={() => void bulkArchive()}
          >
            <Icon icon="iconoir:archive" width="13" /> Archive
          </button>
          <button
            class="p-1 rounded hover:bg-white/10 cursor-pointer"
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
