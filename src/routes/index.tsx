import {
  For,
  Show,
  createEffect,
  createResource,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { A, createAsync, revalidate, useNavigate } from "@solidjs/router";
import { Icon } from "@iconify-icon/solid";
import {
  archiveProject,
  createProject,
  listArchivedProjects,
  listProjects,
  restoreProject,
} from "../lib/api";
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
import type { Project } from "../lib/types";

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
  const [filteredProjects, setFilteredProjects] = createSignal<Project[]>();
  const scope = useScope();
  const [archived, { refetch: refetchArchived }] = createResource(
    () => ({ entityId: scope.entity()?.id ?? null }),
    ({ entityId }) => listArchivedProjects(entityId),
  );
  const [entitiesList, { refetch: refetchEntities }] =
    createResource(listEntities);
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
    void refetchArchived();
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
                    void refetchArchived();
                  });
                },
              },
            ]
          : []),
      ],
    });
  }

  async function unarchive(p: Project) {
    await restoreProject(p.id);
    void refetch();
    void refetchArchived();
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

  createEffect(() => {
    const sel = scope.entity();
    if (sel) {
      setFilteredProjects(projects()?.filter((p) => p.entityId === sel.id));
    } else {
      setFilteredProjects(projects());
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
    navigate(`/p/${id}`);
  }

  return (
    <div class="p-1 h-screen bg-[#fffefe]">
      <div class="rounded-lg overflow-clip w-full flex flex-col h-full border border-[#eceaea]">
        <AppNav
          onOrgSwitch={() => {
            void refetch();
            void refetchArchived();
            void refetchEntities();
          }}
        />

        <main class="flex-1 overflow-y-auto p-8">
          <div class="max-w-3xl mx-auto">
            <div class="flex items-center justify-between mb-6">
              <div class="flex items-center gap-3">
              <EntityAvatar name={scope.entity()?.name || "•"} size={32} />
              <h1 class="text-lg font-semibold text-neutral-800">{scope.entity()?.name || "All"} Projects</h1>
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
                      class="group text-left p-4 border border-neutral-200 rounded-lg bg-white hover:border-neutral-300 hover:shadow-sm transition-all cursor-pointer"
                      onClick={() => navigate(`/p/${p.id}`)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        openProjectMenu(p, e.clientX, e.clientY);
                      }}
                    >
                      <div class="flex items-center justify-between gap-2">
                        <div class="flex items-center gap-2 min-w-0">
                          <Show when={isAdmin()}>
                            <button
                              class="shrink-0 w-3.5 h-3.5 rounded border flex items-center justify-center cursor-pointer"
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
                                <Icon icon="iconoir:check" width="9" />
                              </Show>
                            </button>
                          </Show>
                          <span class="text-sm font-medium text-neutral-800 truncate">
                            {p.name}
                          </span>
                        </div>
                        <div class="flex items-center gap-1.5 shrink-0">
                          <Show when={p.entityName}>
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
                      <p class="mt-1.5 text-xs text-neutral-400">
                        {p.deliverableCount ?? 0} deliverable
                        {p.deliverableCount === 1 ? "" : "s"} ·{" "}
                        {p.phase.replace("_", "-")}
                      </p>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            {/* archived projects (admin+) */}
            <Show when={(archived() ?? []).length > 0}>
              <div class="mt-10">
                <h2 class="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-3">
                  Archived
                </h2>
                <div class="border border-neutral-200 rounded-lg bg-white divide-y divide-neutral-100">
                  <For each={archived()}>
                    {(p) => (
                      <div class="px-4 py-2.5 flex items-center gap-3">
                        <Icon
                          icon="iconoir:archive"
                          width="14"
                          class="text-neutral-300"
                        />
                        <div class="flex-1 min-w-0 flex items-center gap-1.5">
                          <p class="flex-1 min-w-0 text-xs font-medium text-neutral-600 truncate">
                            {p.name}
                          </p>
                          <Show when={p.entityName}>
                            <span class="shrink-0 bg-[#efeded] text-neutral-500 text-[10px] py-0.5 px-1.5 rounded truncate max-w-28">
                              {p.entityName}
                            </span>
                          </Show>
                        </div>
                        <button
                          class="text-[11px] text-sky-700 border border-sky-200 bg-sky-50 rounded px-2 py-1 hover:bg-sky-100 cursor-pointer"
                          onClick={() => void unarchive(p)}
                        >
                          Restore
                        </button>
                      </div>
                    )}
                  </For>
                </div>
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
