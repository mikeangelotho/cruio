import { For, Show, createResource, createSignal } from "solid-js";
import { Icon } from "@iconify-icon/solid";
import { listArchivedProjects, restoreProject } from "../lib/api";
import { deleteEntity, renameEntity } from "../lib/org-api";
import { NavMenu } from "./NavMenu";

type Section = "rename" | "archived" | "delete";

/** Archived-projects list for one entity (or org-wide when entityId is null).
 * Fetches on mount — since it's rendered inside the menu's <Show>, it re-fetches
 * each time the menu opens, so a just-archived project shows up without wiring. */
function ArchivedProjects(props: { entityId: string | null; onChanged?: () => void }) {
  const [archived, { refetch }] = createResource(
    () => props.entityId,
    entityId => listArchivedProjects(entityId),
  );
  async function restore(id: string) {
    await restoreProject(id);
    await refetch();
    props.onChanged?.();
  }
  return (
    <div>
      <p class="px-2 pt-1.5 pb-1 text-[10px] uppercase tracking-wide text-neutral-400">
        Archived projects
      </p>
      <Show
        when={!archived.loading}
        fallback={<p class="px-2 py-2 text-xs text-neutral-400">Loading…</p>}
      >
        <Show
          when={(archived() ?? []).length > 0}
          fallback={<p class="px-2 py-2 text-xs text-neutral-400">No archived projects.</p>}
        >
          <div class="max-h-56 overflow-y-auto">
            <For each={archived()}>
              {p => (
                <div class="flex items-center gap-2 px-2 py-1.5">
                  <Icon icon="iconoir:archive" width="13" class="text-neutral-300 shrink-0" />
                  <span class="flex-1 min-w-0 text-xs text-neutral-600 truncate" title={p.name}>
                    {p.name}
                  </span>
                  <button
                    class="shrink-0 text-[11px] text-on-accent-sky border border-accent-sky-line bg-accent-sky rounded px-2 py-0.5 hover:bg-accent-sky-hover cursor-pointer"
                    onClick={() => void restore(p.id)}
                  >
                    Restore
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
}

/**
 * Entity-scoped options menu — rename, archived-project restore, and delete.
 * Used on the projects screen (next to the entity heading) and on the entities
 * settings page. `sections` narrows which controls appear (settings already has
 * inline rename/delete, so it passes just ["archived"]).
 */
export function EntityOptions(props: {
  /** null = "All Entities" scope: only org-wide archived projects, no rename/delete */
  entity: { id: string; name: string } | null;
  isAdmin: boolean;
  onChanged?: () => void;
  sections?: Section[];
  triggerIcon?: string;
  triggerClass?: string;
  align?: "left" | "right";
}) {
  const sections = () => props.sections ?? ["rename", "archived", "delete"];
  const has = (s: Section) => sections().includes(s);
  const [renaming, setRenaming] = createSignal(false);

  async function rename(name: string) {
    setRenaming(false);
    const trimmed = name.trim();
    if (!props.entity || !trimmed || trimmed === props.entity.name) return;
    await renameEntity(props.entity.id, trimmed);
    props.onChanged?.();
  }

  async function remove() {
    if (!props.entity) return;
    if (!window.confirm(`Delete ${props.entity.name}? Its projects will be left without an entity.`))
      return;
    await deleteEntity(props.entity.id);
    props.onChanged?.();
  }

  return (
    <NavMenu
      align={props.align ?? "right"}
      panelClass="w-64"
      trigger={({ toggle }) => (
        <button
          class={
            props.triggerClass ??
            "flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-800 hover:bg-neutral-200/60 rounded-md px-1.5 py-1 cursor-pointer"
          }
          title="Entity options"
          onClick={toggle}
        >
          <Icon icon={props.triggerIcon ?? "iconoir:settings"} width="15" />
        </button>
      )}
    >
      {({ close }) => (
        <div class="py-1">
          <Show when={props.entity && props.isAdmin && has("rename")}>
            {(() => {
              const e = props.entity!;
              return (
                <div class="px-2 pb-2 border-b border-neutral-100">
                  <p class="pt-1 pb-1 text-[10px] uppercase tracking-wide text-neutral-400">Entity</p>
                  <Show
                    when={renaming()}
                    fallback={
                      <div class="flex items-center gap-2">
                        <Icon icon="iconoir:building" width="13" class="text-neutral-300 shrink-0" />
                        <span class="flex-1 min-w-0 text-xs font-medium text-neutral-700 truncate">
                          {e.name}
                        </span>
                        <button
                          class="shrink-0 text-[11px] text-neutral-500 hover:text-neutral-800 cursor-pointer"
                          onClick={() => setRenaming(true)}
                        >
                          Rename
                        </button>
                      </div>
                    }
                  >
                    <input
                      class="w-full text-xs border border-neutral-200 rounded px-1.5 py-1 outline-none focus:border-sky-400"
                      value={e.name}
                      ref={el => queueMicrotask(() => { el.focus(); el.select(); })}
                      onKeyDown={ev => {
                        if (ev.key === "Enter") (ev.currentTarget as HTMLInputElement).blur();
                        if (ev.key === "Escape") {
                          (ev.currentTarget as HTMLInputElement).value = e.name;
                          (ev.currentTarget as HTMLInputElement).blur();
                        }
                      }}
                      onBlur={ev => void rename(ev.currentTarget.value)}
                    />
                  </Show>
                </div>
              );
            })()}
          </Show>

          <Show when={has("archived")}>
            <ArchivedProjects entityId={props.entity?.id ?? null} onChanged={props.onChanged} />
          </Show>

          <Show when={props.entity && props.isAdmin && has("delete")}>
            <div class="border-t border-neutral-100 mt-1 pt-1 px-1">
              <button
                class="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs text-rose-600 hover:bg-accent-rose cursor-pointer"
                onClick={() => {
                  close();
                  void remove();
                }}
              >
                <Icon icon="iconoir:trash" width="13" /> Delete entity
              </button>
            </div>
          </Show>
        </div>
      )}
    </NavMenu>
  );
}
