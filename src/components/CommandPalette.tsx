import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { Icon } from "@iconify-icon/solid";
import type { ProjectStore } from "../lib/store";
import type { Deliverable } from "../lib/types";

interface Item {
  id: string;
  label: string;
  hint?: string;
  icon: string;
  run: () => void;
}

export function CommandPalette(props: {
  open: boolean;
  onClose: () => void;
  store: ProjectStore;
  currentDeliverable: Deliverable | undefined;
  actions: {
    newDeliverable: () => void;
    openDeliverable: (d: Deliverable) => void;
    upload: () => void;
    approve: () => void;
    requestRevisions: () => void;
    exitReview: () => void;
    fit: () => void;
    compare: () => void;
    history: () => void;
    info: () => void;
    deleteVersion: () => void;
    deleteDeliverable: () => void;
    search: () => void;
  };
}) {
  const navigate = useNavigate();
  const [query, setQuery] = createSignal("");
  const [active, setActive] = createSignal(0);
  let inputRef: HTMLInputElement | undefined;

  createEffect(() => {
    if (props.open) {
      setQuery("");
      setActive(0);
      queueMicrotask(() => inputRef?.focus());
    }
  });

  const items = createMemo<Item[]>(() => {
    const a = props.actions;
    const can = props.store.can;
    const inReview = !!props.currentDeliverable;
    const base: Item[] = inReview
      ? [
          ...(can("version", "upload")
            ? [{ id: "upload", label: "Upload new version", hint: "U", icon: "iconoir:upload", run: a.upload }]
            : []),
          ...(can("approval", "decide")
            ? [
                { id: "approve", label: "Approve version", icon: "iconoir:check", run: a.approve },
                { id: "revise", label: "Request revisions", icon: "iconoir:refresh", run: a.requestRevisions },
              ]
            : []),
          ...(props.currentDeliverable!.versions.length > 1
            ? [{ id: "compare", label: "Compare versions", hint: "C", icon: "iconoir:media-image-list", run: a.compare }]
            : []),
          ...(can("version", "delete") && props.currentDeliverable!.versions.length > 0
            ? [{ id: "delete-version", label: "Delete current version", icon: "iconoir:trash", run: a.deleteVersion }]
            : []),
          ...(can("deliverable", "delete")
            ? [{ id: "delete-deliverable", label: "Delete deliverable", icon: "iconoir:trash", run: a.deleteDeliverable }]
            : []),
          { id: "info", label: "Project info", hint: "I", icon: "iconoir:info-circle", run: a.info },
          { id: "history", label: "Project history", hint: "H", icon: "iconoir:clock", run: a.history },
          { id: "fit", label: "Fit to screen", hint: "F", icon: "iconoir:frame", run: a.fit },
          { id: "back", label: "Back to workspace", hint: "Esc", icon: "iconoir:arrow-left", run: a.exitReview },
        ]
      : [
          ...(can("deliverable", "create")
            ? [{ id: "new", label: "New deliverable", hint: "N", icon: "iconoir:plus", run: a.newDeliverable }]
            : []),
          { id: "info", label: "Project info", hint: "I", icon: "iconoir:info-circle", run: a.info },
          { id: "history", label: "Project history", hint: "H", icon: "iconoir:clock", run: a.history },
          { id: "fit", label: "Fit to screen", hint: "F", icon: "iconoir:frame", run: a.fit },
        ];
    const jumps: Item[] = props.store.deliverables().map(d => ({
      id: `open-${d.id}`,
      label: `Open: ${d.name}`,
      hint: d.versions.length ? `v${d.versions[d.versions.length - 1].number}` : "empty",
      icon: "iconoir:media-image",
      run: () => a.openDeliverable(d),
    }));
    const isGuest = props.store.state.graph?.viewer.role === "guest";
    const nav: Item[] = [
      { id: "search", label: "Search", hint: "/", icon: "iconoir:search", run: a.search },
      { id: "go-projects", label: "Go to Projects", icon: "iconoir:folder", run: () => navigate("/") },
      { id: "go-library", label: "Go to Library", icon: "iconoir:media-image-folder", run: () => navigate("/library") },
      ...(!isGuest
        ? [{ id: "go-tasks", label: "Go to Tasks", icon: "iconoir:task-list", run: () => navigate("/tasks") }]
        : []),
    ];
    const q = query().toLowerCase().trim();
    const all = [...base, ...jumps, ...nav];
    if (!q) return all;
    return all.filter(i => i.label.toLowerCase().includes(q));
  });

  function runItem(i: Item | undefined) {
    if (!i) return;
    props.onClose();
    i.run();
  }

  return (
    <Show when={props.open}>
      <div
        class="fixed inset-0 z-50 bg-black/10 dark:bg-black/50 flex items-start justify-center pt-[18vh]"
        onClick={props.onClose}
      >
        <div
          class="w-[440px] max-w-[90vw] bg-panel rounded-xl shadow-2xl border border-neutral-200 overflow-hidden"
          onClick={e => e.stopPropagation()}
        >
          <div class="flex items-center gap-2 px-3 border-b border-neutral-100">
            <Icon icon="iconoir:search" width="14" class="text-neutral-400" />
            <input
              ref={inputRef}
              class="flex-1 py-3 text-sm outline-none placeholder:text-neutral-400"
              placeholder="Type a command or deliverable name…"
              value={query()}
              onInput={e => {
                setQuery(e.currentTarget.value);
                setActive(0);
              }}
              onKeyDown={e => {
                e.stopPropagation();
                if (e.key === "Escape") props.onClose();
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive(i => Math.min(i + 1, items().length - 1));
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive(i => Math.max(i - 1, 0));
                }
                if (e.key === "Enter") runItem(items()[active()]);
              }}
            />
          </div>
          <div class="max-h-72 overflow-y-auto py-1">
            <Show
              when={items().length > 0}
              fallback={<p class="px-3 py-4 text-xs text-neutral-400">No matches.</p>}
            >
              <For each={items()}>
                {(item, i) => (
                  <button
                    class="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm cursor-pointer"
                    classList={{
                      "bg-neutral-100": i() === active(),
                      "text-neutral-700": true,
                    }}
                    onMouseEnter={() => setActive(i())}
                    onClick={() => runItem(item)}
                  >
                    <Icon icon={item.icon} width="14" class="text-neutral-400" />
                    <span class="flex-1 truncate">{item.label}</span>
                    <Show when={item.hint}>
                      <span class="text-[10px] text-neutral-400 bg-neutral-100 rounded px-1 py-0.5">
                        {item.hint}
                      </span>
                    </Show>
                  </button>
                )}
              </For>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}
