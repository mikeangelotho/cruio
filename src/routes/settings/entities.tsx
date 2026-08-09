import { For, Show, createResource, createSignal } from "solid-js";
import { createAsync, useNavigate } from "@solidjs/router";
import { Icon } from "@iconify-icon/solid";
import {
  createEntity,
  deleteEntity,
  listEntities,
  myOrgsQuery,
  renameEntity,
  requireUserQuery,
} from "../../lib/org-api";
import { useViewerRole } from "../../lib/viewer";
import { confirm } from "../../lib/confirm";
import { SettingsNav } from "../../components/SettingsNav";
import { AppFooter } from "../../components/AppFooter";
import { EntityOptions } from "../../components/EntityOptions";

export const route = {
  preload: () => {
    void requireUserQuery();
    void myOrgsQuery();
  },
};

export default function EntitiesPage() {
  const navigate = useNavigate();
  const user = createAsync(() => requireUserQuery());
  const orgs = createAsync(() => myOrgsQuery());

  const orgId = () => user()?.activeOrganizationId ?? null;
  const { activeOrg, myRole, isAdmin } = useViewerRole(user, orgs);

  const [entities, { refetch }] = createResource(orgId, () => listEntities());
  const [error, setError] = createSignal("");

  async function add(e: SubmitEvent) {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const name = (form.elements.namedItem("name") as HTMLInputElement).value.trim();
    if (!name) return;
    setError("");
    try {
      await createEntity(name);
      form.reset();
      await refetch();
    } catch (err) {
      setError(String(err));
    }
  }

  async function rename(id: string, name: string, prev: string) {
    if (!name || name === prev) return;
    setError("");
    try {
      await renameEntity(id, name);
      await refetch();
    } catch (err) {
      setError(String(err));
      await refetch();
    }
  }

  async function remove(id: string, name: string, projectCount: number) {
    const note =
      projectCount > 0
        ? `${projectCount} project${projectCount === 1 ? "" : "s"} will be left without an entity.`
        : "This can't be undone.";
    if (
      !(await confirm({
        title: `Delete ${name}?`,
        description: note,
        confirmLabel: "Delete",
        danger: true,
      }))
    )
      return;
    setError("");
    try {
      await deleteEntity(id);
      await refetch();
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <div class="p-1 h-full bg-canvas">
      <div class="rounded-lg overflow-clip w-full flex flex-col h-full border border-line">
        <SettingsNav
          title="Entities"
          orgName={activeOrg()?.name}
          crossLink={{ href: "/settings/members", label: "Members", icon: "iconoir:group" }}
        />

        <main class="flex-1 overflow-y-auto p-8">
          <Show
            when={myRole() === undefined || isAdmin()}
            fallback={(() => {
              navigate("/", { replace: true });
              return null;
            })()}
          >
            <div class="max-w-2xl mx-auto space-y-6">
              <p class="text-xs text-neutral-400 leading-relaxed">
                Entities are who your projects belong to — a client if you're an agency,
                or a department if this is an internal workspace. Create them once here,
                then pick one when starting a project.
              </p>

              <Show when={error()}>
                <p class="text-xs text-on-accent-rose bg-accent-rose border border-accent-rose-line rounded px-3 py-2">
                  {error()}
                </p>
              </Show>

              <form onSubmit={add} class="flex gap-3 items-end">
                <label class="flex-1 text-xs text-neutral-500">
                  New entity
                  <input
                    name="name"
                    required
                    class="mt-1 w-full text-sm border border-neutral-200 rounded px-2 py-1.5 outline-none focus:border-sky-400 bg-panel"
                    placeholder="e.g. Benzel-Busch, or Marketing Dept."
                  />
                </label>
                <button
                  type="submit"
                  class="text-xs bg-brand text-on-brand rounded px-3 py-2 hover:bg-neutral-700 cursor-pointer"
                >
                  Add entity
                </button>
              </form>

              <div class="border border-neutral-200 rounded-lg bg-panel divide-y divide-neutral-100">
                <For each={entities() ?? []}>
                  {c => (
                    <div class="px-4 py-2.5 flex items-center gap-3">
                      <Icon icon="iconoir:building" width="14" class="text-neutral-300" />
                      <input
                        class="flex-1 text-xs font-medium text-neutral-800 bg-transparent border border-transparent rounded px-1.5 py-1 outline-none hover:border-neutral-200 focus:border-sky-400 focus:bg-panel"
                        value={c.name}
                        onKeyDown={e => {
                          if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                          if (e.key === "Escape") {
                            (e.currentTarget as HTMLInputElement).value = c.name;
                            (e.currentTarget as HTMLInputElement).blur();
                          }
                        }}
                        onBlur={e => void rename(c.id, e.currentTarget.value.trim(), c.name)}
                      />
                      <span class="text-[11px] text-neutral-400">
                        {c.projectCount ?? 0} project{c.projectCount === 1 ? "" : "s"}
                      </span>
                      <EntityOptions
                        entity={{ id: c.id, name: c.name }}
                        isAdmin={true}
                        sections={["archived"]}
                        triggerIcon="iconoir:archive"
                        triggerClass="text-neutral-400 hover:text-neutral-700 cursor-pointer p-1"
                        onChanged={() => void refetch()}
                      />
                      <button
                        class="text-neutral-400 hover:text-rose-600 cursor-pointer p-1"
                        title={`Delete ${c.name}`}
                        onClick={() => void remove(c.id, c.name, c.projectCount ?? 0)}
                      >
                        <Icon icon="iconoir:trash" width="13" />
                      </button>
                    </div>
                  )}
                </For>
                <Show when={(entities() ?? []).length === 0 && !entities.loading}>
                  <p class="px-4 py-6 text-xs text-neutral-400 text-center">
                    No entities yet — add the first one above.
                  </p>
                </Show>
              </div>
            </div>
          </Show>
        </main>

        <AppFooter />
      </div>
    </div>
  );
}
