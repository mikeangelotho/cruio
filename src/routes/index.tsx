import {
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
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
  createClient,
  listClients,
  myOrgsQuery,
  requireUserQuery,
} from "../lib/org-api";
import { authClient } from "../lib/auth-client";
import { Avatar, EntityAvatar, SquareAvatar } from "../components/Avatar";
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
  const [projects, { refetch }] = createResource(listProjects);
  const [filteredProjects, setFilteredProjects] = createSignal<Project[]>();
  const [archived, { refetch: refetchArchived }] =
    createResource(listArchivedProjects);
  const [clientsList, { refetch: refetchClients }] =
    createResource(listClients);
  const [creating, setCreating] = createSignal(false);
  const [userMenuOpen, setUserMenuOpen] = createSignal(false);
  const [orgMenuOpen, setOrgMenuOpen] = createSignal(false);
  const [entityMenuOpen, setEntityMenuOpen] = createSignal(false);
  const [clientSel, setClientSel] = createSignal<string | null>(null);
  const [ctxMenu, setCtxMenu] = createSignal<MenuState | null>(null);

  function openProjectMenu(p: Project, x: number, y: number) {
    closeMenus();
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

  const activeOrg = createMemo(() =>
    orgs()?.find((o) => o.id === user()?.activeOrganizationId),
  );
  const myRole = () => activeOrg()?.role;
  const isAdmin = () => myRole() === "admin" || myRole() === "owner";

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
          await revalidate(requireUserQuery.key);
          await refetch();
        });
    }
  });

  createEffect(() => {
    if (clientSel()) {
      setFilteredProjects(
        projects()?.filter((p) => p.clientName === clientSel()),
      );
    } else {
      setFilteredProjects(projects());
    }
  });

  async function switchOrg(orgId: string) {
    if (orgId === user()?.activeOrganizationId) return;
    await authClient.organization.setActive({ organizationId: orgId });
    await revalidate(requireUserQuery.key);
    await refetch();
  }

  async function signOut() {
    await authClient.signOut();
    await revalidate(requireUserQuery.key);
    navigate("/sign-in", { replace: true });
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const name = (
      form.elements.namedItem("name") as HTMLInputElement
    ).value.trim();
    if (!name) return;
    let clientId: string | null = clientSel() || null;
    if (clientSel() === "__new") {
      const newName = (
        form.elements.namedItem("newClient") as HTMLInputElement
      ).value.trim();
      clientId = newName ? (await createClient(newName)).id : null;
      void refetchClients();
    }
    const id = crypto.randomUUID();
    await createProject(id, name, clientId);
    navigate(`/p/${id}`);
  }

  function closeMenus() {
    setUserMenuOpen(false);
    setOrgMenuOpen(false);
    setEntityMenuOpen(false);
  }

  return (
    <div
      class="p-1 h-screen bg-[#fffefe]"
      onClick={() => {
        closeMenus();
      }}
    >
      <div class="rounded-lg overflow-clip w-full flex flex-col h-full border border-[#eceaea]">
        <nav class="min-h-12 px-4 flex items-center justify-between bg-[#f8f7f7] border-b border-[#f0eeee]">
          <div class="flex items-center gap-3">
            <Show when={activeOrg()}>
              {(o) => (
                <div class="relative" onClick={(e) => e.stopPropagation()}>
                  <button
                    class="flex items-center gap-1.5 cursor-pointer px-2 py-2 rounded-lg hover:bg-neutral-200/80"
                    onClick={() => {
                      closeMenus();
                      setOrgMenuOpen((o) => !o);
                    }}
                  >
                    <SquareAvatar name={o().name} size={21} />
                    <span class="text-xs">{o().name}</span>
                    <Icon
                      icon="iconoir:nav-arrow-down"
                      width="10"
                      class="text-neutral-400"
                    />
                  </button>
                  <Show when={orgMenuOpen()}>
                    <div class="absolute top-full left-0 mt-1 w-48 bg-white border border-neutral-200 rounded-lg shadow-xl z-30">
                      <div class="p-3 flex gap-3 items-center">
                        <SquareAvatar name={o().name} size={32} />
                        <div class="border-b border-neutral-100">
                          <p class="text-xs font-medium text-neutral-800 truncate">
                            {o().name}
                          </p>
                          <Show when={myRole()}>
                            <p class="mt-0.5 text-[10px] text-neutral-400">
                              {myRole()} · {activeOrg()?.name}
                            </p>
                          </Show>
                        </div>
                      </div>
                      <Show when={isAdmin()}>
                        <div class="p-3 border-b border-neutral-100">
                          <A
                            href="/settings/clients"
                            class="rounded-md w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-neutral-600 hover:bg-neutral-50 cursor-pointer"
                          >
                            <Icon icon="iconoir:building" width="14" /> Clients
                          </A>
                          <A
                            href="/settings/members"
                            class="rounded-md w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-neutral-600 hover:bg-neutral-50 cursor-pointer"
                          >
                            <Icon icon="iconoir:group" width="14" /> Members
                          </A>
                        </div>
                      </Show>
                      <div class="p-3">
                        <button
                          class="rounded-md w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-neutral-600 hover:bg-neutral-50 cursor-pointer"
                          onClick={() => void signOut()}
                        >
                          <span class="w-full flex items-center justify-between">
                            Switch Workspace
                            <Icon icon="iconoir:nav-arrow-right" width="13" />
                          </span>
                        </button>
                      </div>
                    </div>
                  </Show>
                </div>
              )}
            </Show>
            <Show when={clientsList()}>
              {(l) => (
                <div class="relative" onClick={(e) => e.stopPropagation()}>
                  <button
                    class="outline outline-neutral-200/80 flex items-center gap-1.5 cursor-pointer px-2 py-2 rounded-lg hover:bg-neutral-200/80"
                    onClick={() => {
                      closeMenus();
                      setEntityMenuOpen((o) => !o);
                    }}
                  >
                    <EntityAvatar name={clientSel() || "•"} size={21} />
                    <span class="text-xs">{clientSel() || "All"}</span>
                    <Icon
                      icon="iconoir:arrow-separate-vertical"
                      width="10"
                      class="text-neutral-400"
                    />
                  </button>
                  <Show when={entityMenuOpen()}>
                    <div class="absolute top-full left-0 mt-1 w-48 bg-white border border-neutral-200 rounded-lg shadow-xl z-30">
                      <div class="p-3">
                        <div
                          class="rounded-md w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-neutral-600 hover:bg-neutral-50 cursor-pointer"
                          onClick={() => {
                            closeMenus();
                            setClientSel(null);
                          }}
                        >
                          <EntityAvatar name="•" size={18} />
                          All Entities
                        </div>
                        <For each={l()}>
                          {(c) => (
                            <div
                              class="rounded-md w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-neutral-600 hover:bg-neutral-50 cursor-pointer"
                              onClick={() => {
                                closeMenus();
                                setClientSel(c.name);
                              }}
                            >
                              <EntityAvatar name={c.name} size={18} />
                              {c.name}
                            </div>
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>
                </div>
              )}
            </Show>
            {/* org switcher 
            <Show when={(orgs() ?? []).length > 0}>
              <select
                class="text-xs border border-transparent hover:border-neutral-200 rounded px-1.5 py-1 bg-transparent outline-none cursor-pointer text-neutral-600"
                value={user()?.activeOrganizationId ?? ""}
                onChange={(e) => void switchOrg(e.currentTarget.value)}
              >
                <For each={orgs()}>
                  {(o) => <option value={o.id}>{o.name}</option>}
                </For>
              </select>
            </Show>
            */}
          </div>

          <div class="flex items-center gap-6">
            <Show when={isAdmin()}>
              <A
                href="/settings/clients"
                class="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-800"
              >
                <Icon icon="iconoir:building" width="14" />
                Tasks
              </A>
              <A
                href="/settings/clients"
                class="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-800"
              >
                <Icon icon="iconoir:building" width="14" />
                Projects
              </A>
              <A
                href="/settings/members"
                class="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-800"
              >
                <Icon icon="iconoir:media-image-folder" width="14" />
                Library
              </A>
            </Show>
            <div class="opacity-50 p-1 rounded hover:bg-neutral-200/80 cursor-pointer hover:opacity-100 flex items-center">
              <Icon icon="iconoir:sidebar-expand" width="18" rotate={90} />
            </div>
          </div>
        </nav>

        <main class="flex-1 overflow-y-auto p-8">
          <div class="max-w-3xl mx-auto">
            <div class="flex items-center justify-between mb-6">
              <h1 class="text-lg font-semibold text-neutral-800">Projects</h1>
              <Show when={isAdmin()}>
                <button
                  class="flex items-center gap-1 text-xs bg-neutral-900 text-white rounded-md px-3 py-1.5 hover:bg-neutral-700 cursor-pointer"
                  onClick={() => setCreating((c) => !c)}
                >
                  <Icon icon="iconoir:plus" width="14" /> New project
                </button>
              </Show>
            </div>

            <Show when={creating()}>
              <form
                onSubmit={submit}
                class="mb-6 p-4 border border-neutral-200 rounded-lg bg-white flex gap-3 items-end"
              >
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
                <label class="flex-1 text-xs text-neutral-500">
                  Client
                  <select
                    class="mt-1 block w-full text-sm border border-neutral-200 rounded px-2 py-1.5 outline-none focus:border-sky-400 bg-white"
                    onChange={(e) => setClientSel(e.currentTarget.value)}
                  >
                    <option value="" selected={clientSel() === ""}>
                      No client
                    </option>
                    <For each={clientsList() ?? []}>
                      {(c) => (
                        <option value={c.id} selected={clientSel() === c.id}>
                          {c.name}
                        </option>
                      )}
                    </For>
                    <option value="__new" selected={clientSel() === "__new"}>
                      ＋ New client…
                    </option>
                  </select>
                </label>
                <Show when={clientSel() === "__new"}>
                  <label class="flex-1 text-xs text-neutral-500">
                    New client name
                    <input
                      name="newClient"
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
              when={(projects() ?? []).length > 0}
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
                        <span class="text-sm font-medium text-neutral-800 truncate">
                          {p.name}
                        </span>
                        <div class="flex items-center gap-1.5 shrink-0">
                          <Show when={p.clientName}>
                            <span class="bg-[#efeded] text-neutral-500 text-[11px] py-0.5 px-1.5 rounded">
                              {p.clientName}
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
                        <div class="flex-1 min-w-0">
                          <p class="text-xs font-medium text-neutral-600 truncate">
                            {p.name}
                          </p>
                          <Show when={p.clientName}>
                            <p class="text-[10px] text-neutral-400 truncate">
                              {p.clientName}
                            </p>
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

        <footer class="relative min-h-7 px-3 py-1 flex gap-3 items-center justify-between bg-[#f8f7f7] border-t border-[#f0eeee] text-[11px] text-neutral-400">
          <div class="w-full flex items-center justify-start">
            <Show when={user()}>
              {(u) => (
                <div class="relative" onClick={(e) => e.stopPropagation()}>
                  <button
                    class="flex items-center gap-1.5 cursor-pointer px-1 py-1 rounded-lg hover:bg-neutral-200/80"
                    onClick={() => {
                      closeMenus();
                      setUserMenuOpen((o) => !o);
                    }}
                  >
                    <Avatar name={u().name} size={21} />
                  </button>
                  <Show when={userMenuOpen()}>
                    <div class="absolute bottom-full left-0 mt-1 w-48 bg-white border border-neutral-200 rounded-lg shadow-xl py-1 z-30">
                      <div class="px-3 py-2 border-b border-neutral-100">
                        <p class="text-xs font-medium text-neutral-800 truncate">
                          {u().name}
                        </p>
                        <p class="text-[10px] text-neutral-400 truncate">
                          {u().email}
                        </p>
                        <Show when={myRole()}>
                          <p class="mt-0.5 text-[10px] text-neutral-400">
                            {myRole()} · {activeOrg()?.name}
                          </p>
                        </Show>
                      </div>
                      <button
                        class="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-neutral-600 hover:bg-neutral-50 cursor-pointer"
                        onClick={() => void signOut()}
                      >
                        <Icon icon="iconoir:log-out" width="13" /> Sign out
                      </button>
                    </div>
                  </Show>
                </div>
              )}
            </Show>
          </div>
          <div class="w-full flex items-center justify-center">
            <a
              href="./"
              class="opacity-20 hover:opacity-100 transition-opacity ease-in-out duration-150"
            >
              <img style="height: 16px;" src="/CRIO_Logo-2026.svg" />
            </a>
          </div>
          <div class="w-full flex items-center justify-end">
            <div class="opacity-50 p-1 rounded hover:bg-neutral-200/80 cursor-pointer hover:opacity-100 flex items-center">
              <Icon icon="iconoir:more-horiz" width="18" />
            </div>
          </div>
        </footer>
      </div>
      <ContextMenu state={ctxMenu()} onClose={() => setCtxMenu(null)} />
    </div>
  );
}
