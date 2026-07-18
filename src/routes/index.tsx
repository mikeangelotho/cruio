import { For, Show, createResource, createSignal } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { Icon } from "@iconify-icon/solid";
import { createProject, listProjects } from "../lib/api";

export default function Home() {
  const navigate = useNavigate();
  const [projects, { refetch }] = createResource(listProjects);
  const [creating, setCreating] = createSignal(false);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const name = (form.elements.namedItem("name") as HTMLInputElement).value.trim();
    const client = (form.elements.namedItem("client") as HTMLInputElement).value.trim();
    if (!name) return;
    const id = crypto.randomUUID();
    await createProject(id, name, client);
    navigate(`/p/${id}`);
  }

  return (
    <div class="p-1 h-screen bg-[#fffefe]">
      <div class="rounded-lg overflow-clip w-full flex flex-col h-full border border-[#eceaea]">
        <nav class="min-h-12 px-4 flex items-center justify-between bg-[#f8f7f7] border-b border-[#f0eeee]">
          <span class="text-sm font-semibold tracking-tight text-neutral-800">cruio</span>
          <span class="text-[11px] text-neutral-400">creative pipeline</span>
        </nav>

        <main class="flex-1 overflow-y-auto p-8">
          <div class="max-w-3xl mx-auto">
            <div class="flex items-center justify-between mb-6">
              <h1 class="text-lg font-semibold text-neutral-800">Projects</h1>
              <button
                class="flex items-center gap-1 text-xs bg-neutral-900 text-white rounded px-2.5 py-1.5 hover:bg-neutral-700 cursor-pointer"
                onClick={() => setCreating(c => !c)}
              >
                <Icon icon="iconoir:plus" width="14" /> New project
              </button>
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
                    ref={el => queueMicrotask(() => el.focus())}
                  />
                </label>
                <label class="flex-1 text-xs text-neutral-500">
                  Client
                  <input
                    name="client"
                    class="mt-1 w-full text-sm border border-neutral-200 rounded px-2 py-1.5 outline-none focus:border-sky-400"
                    placeholder="Benzel-Busch"
                  />
                </label>
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
                    <p class="mt-3 text-sm text-neutral-500 font-medium">No projects yet</p>
                    <p class="mt-1 text-xs">Create your first project to open its canvas.</p>
                  </div>
                </Show>
              }
            >
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <For each={projects()}>
                  {p => (
                    <button
                      class="text-left p-4 border border-neutral-200 rounded-lg bg-white hover:border-neutral-300 hover:shadow-sm transition-all cursor-pointer"
                      onClick={() => navigate(`/p/${p.id}`)}
                    >
                      <div class="flex items-center justify-between">
                        <span class="text-sm font-medium text-neutral-800">{p.name}</span>
                        <Show when={p.clientName}>
                          <span class="bg-[#efeded] text-neutral-500 text-[11px] py-0.5 px-1.5 rounded">
                            {p.clientName}
                          </span>
                        </Show>
                      </div>
                      <p class="mt-1.5 text-xs text-neutral-400">
                        {p.deliverableCount ?? 0} deliverable{p.deliverableCount === 1 ? "" : "s"} ·{" "}
                        {p.phase.replace("_", "-")}
                      </p>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </main>

        <footer class="min-h-7 px-3 flex items-center bg-[#f8f7f7] border-t border-[#f0eeee] text-[11px] text-neutral-400">
          cruio · crew I/O
        </footer>
      </div>
    </div>
  );
}
