import { For, Show, createMemo, createResource, createSignal } from "solid-js";
import { A, createAsync, useNavigate } from "@solidjs/router";
import { Icon } from "@iconify-icon/solid";
import {
  createClient,
  deleteClient,
  listClients,
  myOrgsQuery,
  renameClient,
  requireUserQuery,
} from "../../lib/org-api";

export const route = {
  preload: () => {
    void requireUserQuery();
    void myOrgsQuery();
  },
};

export default function ClientsPage() {
  const navigate = useNavigate();
  const user = createAsync(() => requireUserQuery());
  const orgs = createAsync(() => myOrgsQuery());

  const orgId = () => user()?.activeOrganizationId ?? null;
  const myRole = createMemo(() => orgs()?.find(o => o.id === orgId())?.role);
  const isAdmin = () => myRole() === "admin" || myRole() === "owner";

  const [clients, { refetch }] = createResource(orgId, () => listClients());
  const [error, setError] = createSignal("");

  async function add(e: SubmitEvent) {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const name = (form.elements.namedItem("name") as HTMLInputElement).value.trim();
    if (!name) return;
    setError("");
    try {
      await createClient(name);
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
      await renameClient(id, name);
      await refetch();
    } catch (err) {
      setError(String(err));
      await refetch();
    }
  }

  async function remove(id: string, name: string, projectCount: number) {
    const note =
      projectCount > 0
        ? `Delete ${name}? ${projectCount} project${projectCount === 1 ? "" : "s"} will be left without a client.`
        : `Delete ${name}?`;
    if (!window.confirm(note)) return;
    setError("");
    try {
      await deleteClient(id);
      await refetch();
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <div class="p-1 h-screen bg-[#fffefe]">
      <div class="rounded-lg overflow-clip w-full flex flex-col h-full border border-[#eceaea]">
        <nav class="min-h-12 px-4 flex items-center justify-between bg-[#f8f7f7] border-b border-[#f0eeee]">
          <div class="flex items-center gap-2 text-sm">
            <A href="/" class="flex items-center text-neutral-500 hover:text-neutral-800 p-1">
              <Icon icon="iconoir:arrow-left" width="16" />
            </A>
            <span class="font-medium text-neutral-800">Clients</span>
            <Show when={orgs()?.find(o => o.id === orgId())}>
              {o => (
                <span class="bg-[#efeded] text-neutral-500 text-xs py-0.5 px-1.5 rounded">
                  {o().name}
                </span>
              )}
            </Show>
          </div>
          <A
            href="/settings/members"
            class="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-800"
          >
            <Icon icon="iconoir:group" width="14" /> Members
          </A>
        </nav>

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
                Clients are the companies (or internal departments) your projects belong to.
                Create them once here, then pick one when starting a project.
              </p>

              <Show when={error()}>
                <p class="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded px-3 py-2">
                  {error()}
                </p>
              </Show>

              <form onSubmit={add} class="flex gap-3 items-end">
                <label class="flex-1 text-xs text-neutral-500">
                  New client
                  <input
                    name="name"
                    required
                    class="mt-1 w-full text-sm border border-neutral-200 rounded px-2 py-1.5 outline-none focus:border-sky-400 bg-white"
                    placeholder="e.g. Benzel-Busch, or Marketing Dept."
                  />
                </label>
                <button
                  type="submit"
                  class="text-xs bg-neutral-900 text-white rounded px-3 py-2 hover:bg-neutral-700 cursor-pointer"
                >
                  Add client
                </button>
              </form>

              <div class="border border-neutral-200 rounded-lg bg-white divide-y divide-neutral-100">
                <For each={clients() ?? []}>
                  {c => (
                    <div class="px-4 py-2.5 flex items-center gap-3">
                      <Icon icon="iconoir:building" width="14" class="text-neutral-300" />
                      <input
                        class="flex-1 text-xs font-medium text-neutral-800 bg-transparent border border-transparent rounded px-1.5 py-1 outline-none hover:border-neutral-200 focus:border-sky-400 focus:bg-white"
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
                <Show when={(clients() ?? []).length === 0 && !clients.loading}>
                  <p class="px-4 py-6 text-xs text-neutral-400 text-center">
                    No clients yet — add the first one above.
                  </p>
                </Show>
              </div>
            </div>
          </Show>
        </main>

        <footer class="min-h-7 px-3 flex items-center bg-[#f8f7f7] border-t border-[#f0eeee] text-[11px] text-neutral-400">
          cruio · crew I/O
        </footer>
      </div>
    </div>
  );
}
