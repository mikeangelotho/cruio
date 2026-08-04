import { For, Show, createResource, createSignal } from "solid-js";
import { A, createAsync, revalidate, useLocation } from "@solidjs/router";
import { Icon } from "@iconify-icon/solid";
import {
  createEntity,
  listEntities,
  myOrgsQuery,
  requireUserQuery,
  sessionQuery,
} from "../lib/org-api";
import { authClient } from "../lib/auth-client";
import { useViewerRole } from "../lib/viewer";
import { EntityAvatar, SquareAvatar } from "./Avatar";
import { GlobalSearch } from "./GlobalSearch";
import { AiTrigger } from "./ai/AiTrigger";
import { NavMenu } from "./NavMenu";
import { useScope } from "./ScopeProvider";

/**
 * Shared top nav: workspace switcher + entity selector on the left scope
 * what the links on the right (Tasks / Projects / Library) show.
 */
export function AppNav(props: { onOrgSwitch?: () => void }) {
  const location = useLocation();
  const user = createAsync(() => requireUserQuery());
  const orgs = createAsync(() => myOrgsQuery());
  const [entitiesList, { refetch: refetchEntities }] = createResource(
    () => user()?.activeOrganizationId ?? null,
    () => listEntities(),
  );
  const scope = useScope();
  // inline "New entity" creation from the entity dropdown
  const [addingEntity, setAddingEntity] = createSignal(false);

  async function addEntity(name: string, close: () => void) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const created = await createEntity(trimmed);
    await refetchEntities();
    setAddingEntity(false);
    scope.setEntity({ id: created.id, name: created.name });
    close();
  }
  const { activeOrg, myRole, isAdmin, isGuest } = useViewerRole(user, orgs);

  async function switchOrg(orgId: string) {
    if (orgId === user()?.activeOrganizationId) return;
    await authClient.organization.setActive({ organizationId: orgId });
    await revalidate([requireUserQuery.key, sessionQuery.key, myOrgsQuery.key]);
    props.onOrgSwitch?.();
  }

  const linkClass = (href: string) =>
    `flex items-center gap-1 text-xs ${
      location.pathname === href
        ? "text-neutral-800 font-medium"
        : "text-neutral-500 hover:text-neutral-800"
    }`;

  return (
    <nav class="min-h-12 px-4 flex items-center gap-4 bg-surface border-b border-hairline">
      <div class="flex-1 flex items-center gap-3 min-w-0">
        <a href="/" class="shrink-0 flex items-center" aria-label="Cruio home">
          <img class="dark:invert" style="height: 16px;" src="/CRIO_Logo-2026.svg" />
        </a>
        <Show when={activeOrg()}>
          {o => (
            <NavMenu
              panelClass="w-52"
              trigger={({ toggle }) => (
                <button
                  class="flex items-center gap-1.5 cursor-pointer px-2 py-2 rounded-lg hover:bg-neutral-200/80"
                  onClick={toggle}
                >
                  <SquareAvatar name={o().name} size={21} />
                  <span class="text-xs truncate max-w-32">{o().name}</span>
                  <Icon icon="iconoir:nav-arrow-down" width="10" class="shrink-0 text-neutral-400" />
                </button>
              )}
            >
              {({ close }) => (
                <>
                  <div class="p-3 flex gap-3 items-center border-b border-neutral-100">
                    <SquareAvatar name={o().name} size={32} />
                    <div class="min-w-0">
                      <p class="text-xs font-medium text-neutral-800 truncate">{o().name}</p>
                      <Show when={myRole()}>
                        <p class="mt-0.5 text-[10px] text-neutral-400">{myRole()}</p>
                      </Show>
                    </div>
                  </div>
                  <Show when={isAdmin()}>
                    <div class="p-2 border-b border-neutral-100">
                      <A
                        href="/settings/entities"
                        class="rounded-md w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-neutral-600 hover:bg-neutral-50 cursor-pointer"
                        onClick={close}
                      >
                        <Icon icon="iconoir:building" width="14" /> Entities
                      </A>
                      <A
                        href="/settings/members"
                        class="rounded-md w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-neutral-600 hover:bg-neutral-50 cursor-pointer"
                        onClick={close}
                      >
                        <Icon icon="iconoir:group" width="14" /> Members
                      </A>
                    </div>
                  </Show>
                  <div class="p-2">
                    <p class="px-3 pt-1 pb-1.5 text-[10px] uppercase tracking-wide text-neutral-400">
                      Workspaces
                    </p>
                    <For each={orgs() ?? []}>
                      {w => (
                        <button
                          class="rounded-md w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-neutral-600 hover:bg-neutral-50 cursor-pointer"
                          onClick={() => {
                            close();
                            void switchOrg(w.id);
                          }}
                        >
                          <SquareAvatar name={w.name} size={18} />
                          <span class="flex-1 truncate">{w.name}</span>
                          <Show when={w.id === o().id}>
                            <Icon icon="iconoir:check" width="12" class="text-neutral-400" />
                          </Show>
                        </button>
                      )}
                    </For>
                    <A
                      href="/onboarding"
                      class="rounded-md w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-neutral-500 hover:bg-neutral-50 cursor-pointer"
                      onClick={close}
                    >
                      <Icon icon="iconoir:plus" width="13" /> New workspace
                    </A>
                  </div>
                </>
              )}
            </NavMenu>
          )}
        </Show>
        <Show when={entitiesList()}>
          {l => (
            <NavMenu
              panelClass="w-48"
              trigger={({ toggle }) => (
                <button
                  class="outline outline-neutral-200/80 flex items-center gap-1.5 cursor-pointer px-2 py-2 rounded-lg hover:bg-neutral-200/80"
                  onClick={toggle}
                >
                  <EntityAvatar name={scope.entity()?.name || "•"} size={21} />
                  <span class="text-xs truncate max-w-32">{scope.entity()?.name || "All"}</span>
                  <Icon
                    icon="iconoir:arrow-separate-vertical"
                    width="10"
                    class="shrink-0 text-neutral-400"
                  />
                </button>
              )}
            >
              {({ close }) => (
                <div class="p-2">
                  <button
                    class="rounded-md w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-neutral-600 hover:bg-neutral-50 cursor-pointer"
                    onClick={() => {
                      close();
                      scope.setEntity(null);
                    }}
                  >
                    <EntityAvatar name="•" size={18} />
                    <span class="flex-1 truncate">All Entities</span>
                  </button>
                  <For each={l()}>
                    {c => (
                      <button
                        class="rounded-md w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-neutral-600 hover:bg-neutral-50 cursor-pointer"
                        onClick={() => {
                          close();
                          scope.setEntity({ id: c.id, name: c.name });
                        }}
                      >
                        <EntityAvatar name={c.name} size={18} />
                        <span class="flex-1 truncate">{c.name}</span>
                      </button>
                    )}
                  </For>
                  <Show when={isAdmin()}>
                    <div class="mt-1 pt-1 border-t border-neutral-100">
                      <Show
                        when={addingEntity()}
                        fallback={
                          <button
                            class="rounded-md w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-neutral-500 hover:bg-neutral-50 cursor-pointer"
                            onClick={() => setAddingEntity(true)}
                          >
                            <Icon icon="iconoir:plus" width="13" /> New entity…
                          </button>
                        }
                      >
                        <input
                          class="w-full text-xs border border-neutral-200 rounded px-2 py-1.5 outline-none focus:border-sky-400 bg-panel placeholder:text-neutral-400"
                          placeholder="Entity name — Enter to add"
                          ref={el => queueMicrotask(() => el.focus())}
                          onKeyDown={e => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void addEntity((e.currentTarget as HTMLInputElement).value, close);
                            }
                            if (e.key === "Escape") setAddingEntity(false);
                          }}
                          onBlur={() => setAddingEntity(false)}
                        />
                      </Show>
                    </div>
                  </Show>
                </div>
              )}
            </NavMenu>
          )}
        </Show>

        <div class="flex items-center gap-5 shrink-0 ml-1">
          <Show when={!isGuest()}>
            <A href="/tasks" class={linkClass("/tasks")}>
              <Icon icon="iconoir:task-list" width="14" />
              Tasks
            </A>
          </Show>
          <A href="/" class={linkClass("/")}>
            <Icon icon="iconoir:folder" width="14" />
            Projects
          </A>
          <A href="/library" class={linkClass("/library")}>
            <Icon icon="iconoir:media-image-folder" width="14" />
            Library
          </A>
        </div>
      </div>

      <div class="flex-1 flex items-center gap-2 justify-end min-w-0">
        <GlobalSearch orgId={() => user()?.activeOrganizationId ?? null} />
        <Show when={!isGuest()}>
          <AiTrigger />
        </Show>
      </div>
    </nav>
  );
}
