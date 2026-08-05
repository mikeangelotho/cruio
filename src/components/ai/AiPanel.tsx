import { createAsync, useLocation } from "@solidjs/router";
import { Icon } from "@iconify-icon/solid";
import { For, Show, createEffect, createMemo, createResource, createSignal, on, onCleanup, onMount } from "solid-js";
import { listEntities, myOrgsQuery, sessionQuery } from "../../lib/org-api";
import { listProjects } from "../../lib/api";
import { useViewerRole } from "../../lib/viewer";
import { useScope } from "../ScopeProvider";
import { useChat } from "../../lib/ai/useChat";
import { listMyConversations } from "../../lib/ai/conversations";
import { viewContext } from "../../lib/ai/viewContext";
import type { ContextItem } from "../../lib/ai/prompt";
import { aiPanelOpen, minimizeAiPanel, toggleAiPanel } from "../../lib/ai/panelState";
import { timeAgo } from "../../lib/time";
import { NavMenu } from "../NavMenu";
import { MessageList } from "./MessageList";

const HIDDEN = ["/sign-in", "/sign-up", "/onboarding", "/invite"];

const CTX_ICON: Record<ContextItem["kind"], string> = {
  project: "iconoir:folder",
  deliverable: "iconoir:media-image",
  entity: "iconoir:building",
};
const chipKey = (c: ContextItem) => `${c.kind}:${c.id}`;

/**
 * The assistant panel. Rendered once at the Router root (see app.tsx) so its
 * chat state survives client-side navigation; the trigger that opens it lives
 * in AppFooter (AiTrigger) and toggles the shared `aiPanelOpen` signal, since
 * the footer itself remounts on every route.
 *
 * Positioned to grow out of that footer trigger's corner — same
 * `bg-panel border rounded-lg shadow-xl` popover language as NavMenu,
 * ContextMenu, and the project-info panel — rather than floating as an
 * unrelated widget on top of the page.
 */
export function AiPanel() {
  const location = useLocation();
  // This panel mounts at the app root, on every route. Hidden routes are the
  // signed-out surfaces (/sign-in, /sign-up, …); never fetch auth-gated data
  // there. myOrgsQuery throws redirect("/sign-in") when signed out, so calling
  // it on the sign-in page itself would redirect-loop the page.
  const hidden = createMemo(() => HIDDEN.some(p => location.pathname.startsWith(p)));
  const user = createAsync(() => sessionQuery());
  const orgs = createAsync(() =>
    !hidden() && user() ? myOrgsQuery() : Promise.resolve(undefined),
  );
  const { isGuest } = useViewerRole(() => user() ?? undefined, () => orgs());

  // Two-frame delay before the "entered" class applies, so the transition
  // actually animates from the closed state instead of snapping in.
  let panelEl: HTMLDivElement | undefined;
  createEffect(() => {
    if (!aiPanelOpen() || !panelEl) return;
    const el = panelEl;
    el.classList.add("opacity-0", "scale-95");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => el.classList.remove("opacity-0", "scale-95"));
    });
  });

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!allowed()) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "i") {
        e.preventDefault();
        toggleAiPanel();
      } else if (e.key === "Escape" && aiPanelOpen()) {
        minimizeAiPanel();
      }
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  // ---- context chips -------------------------------------------------------
  // Auto-derived from the current screen (mirrors the search bar's scope): the
  // project (+ deliverable when reviewing) on the canvas, otherwise the active
  // entity scope. Removable individually and all-at-once; the removals reset
  // whenever the screen context changes so chips re-appear on navigation. The
  // user can also add extra projects/entities, which persist.
  const scope = useScope();
  const autoChips = createMemo<ContextItem[]>(() => {
    const v = viewContext();
    if (v.project) {
      const chips: ContextItem[] = [{ kind: "project", id: v.project.id, label: v.project.name }];
      if (v.deliverable) chips.push({ kind: "deliverable", id: v.deliverable.id, label: v.deliverable.name });
      return chips;
    }
    const ent = scope.entity();
    return ent ? [{ kind: "entity", id: ent.id, label: ent.name }] : [];
  });
  const [removed, setRemoved] = createSignal<Set<string>>(new Set());
  const [manual, setManual] = createSignal<ContextItem[]>([]);
  const autoKey = createMemo(() => autoChips().map(chipKey).join("|"));
  createEffect(on(autoKey, () => setRemoved(new Set())));

  const chips = createMemo<ContextItem[]>(() => {
    const auto = autoChips().filter(c => !removed().has(chipKey(c)));
    const extra = manual().filter(m => !auto.some(a => chipKey(a) === chipKey(m)));
    return [...auto, ...extra];
  });
  const presentKeys = () => new Set(chips().map(chipKey));

  function removeChip(c: ContextItem) {
    const k = chipKey(c);
    setManual(m => m.filter(x => chipKey(x) !== k));
    setRemoved(s => new Set(s).add(k));
  }
  function clearChips() {
    const keys = chips().map(chipKey);
    setManual([]);
    setRemoved(s => {
      const n = new Set(s);
      for (const k of keys) n.add(k);
      return n;
    });
  }
  function addChip(c: ContextItem) {
    setRemoved(s => {
      const n = new Set(s);
      n.delete(chipKey(c));
      return n;
    });
    setManual(m => (m.some(x => chipKey(x) === chipKey(c)) ? m : [...m, c]));
  }

  // Lazily fetched when the "add" menu opens (tick-sourced, like history).
  const [addTick, setAddTick] = createSignal(0);
  const [addData] = createResource(addTick, async t =>
    t
      ? {
          projects: await listProjects(scope.entity()?.id ?? null),
          entities: await listEntities(),
        }
      : null,
  );

  const chat = useChat(() => location.pathname, chips);

  // Refetched fresh each time the history menu opens, not cached — a bumped
  // source signal is simpler here than reasoning about a resource created
  // inside NavMenu's render-prop.
  const [historyTick, setHistoryTick] = createSignal(0);
  const [conversations] = createResource(historyTick, () => listMyConversations());

  // Guests get no AI surface at all — this gates both rendering and Ctrl+I.
  const allowed = createMemo(() => !!user() && !isGuest() && !hidden());

  return (
    <Show when={allowed() && aiPanelOpen()}>
      <div
        ref={panelEl}
        role="dialog"
        aria-label="Assistant"
        class="fixed bottom-12 right-4 z-30 w-[380px] max-w-[calc(100vw-2rem)] h-[min(560px,calc(100vh-6rem))] flex flex-col bg-panel border border-neutral-200 rounded-lg shadow-xl overflow-hidden transition-[opacity,transform] duration-150 ease-out"
      >
        <header class="shrink-0 h-9 pl-3 pr-1.5 flex items-center gap-2 border-b border-neutral-100">
          <span class="text-xs font-medium text-neutral-700">Assistant</span>
          <span class="flex-1" />
          <NavMenu
            anchor="bottom"
            align="right"
            panelClass="w-64 max-h-80 overflow-y-auto py-1"
            trigger={({ toggle }) => (
              <button
                type="button"
                onClick={() => {
                  setHistoryTick(t => t + 1);
                  toggle();
                }}
                title="History"
                aria-label="Conversation history"
                class="w-6 h-6 grid place-items-center rounded-md text-neutral-500 hover:text-neutral-800 hover:bg-neutral-100 transition-colors"
              >
                <Icon icon="iconoir:clock-rotate-right" width="14" />
              </button>
            )}
          >
            {({ close }) => (
              <Show
                when={!conversations.loading}
                fallback={<p class="px-3 py-2 text-xs text-neutral-400">Loading…</p>}
              >
                <Show
                  when={conversations()?.length}
                  fallback={<p class="px-3 py-2 text-xs text-neutral-400">No past conversations yet.</p>}
                >
                  <For each={conversations()}>
                    {c => (
                      <button
                        type="button"
                        onClick={() => {
                          void chat.load(c.id);
                          close();
                        }}
                        class="block w-full text-left px-3 py-1.5 hover:bg-neutral-50 transition-colors"
                      >
                        <p class="text-xs text-neutral-800 truncate">
                          {c.title || "New chat"}
                        </p>
                        <p class="text-[10px] text-neutral-400">{timeAgo(c.updatedAt)}</p>
                      </button>
                    )}
                  </For>
                </Show>
              </Show>
            )}
          </NavMenu>
          <button
            type="button"
            onClick={chat.reset}
            title="New chat"
            aria-label="New chat"
            class="w-6 h-6 grid place-items-center rounded-md text-neutral-500 hover:text-neutral-800 hover:bg-neutral-100 transition-colors"
          >
            <Icon icon="iconoir:plus" width="14" />
          </button>
          <button
            type="button"
            onClick={minimizeAiPanel}
            title="Minimize"
            aria-label="Minimize assistant"
            class="w-6 h-6 grid place-items-center rounded-md text-neutral-500 hover:text-neutral-800 hover:bg-neutral-100 transition-colors"
          >
            <Icon icon="iconoir:minus" width="14" />
          </button>
        </header>

        <MessageList chat={chat} />

        <div class="shrink-0 px-2.5 pb-2.5">
          <Show when={chat.error()}>
            <p class="mb-2 text-xs leading-snug rounded-md px-2 py-1.5 bg-accent-rose text-on-accent-rose">
              {chat.error()}
            </p>
          </Show>

          <div class="mb-2 flex flex-wrap items-center gap-1">
            <For each={chips()}>
              {c => (
                <span class="flex items-center gap-1 rounded bg-neutral-100 text-neutral-600 px-1.5 py-0.5 text-[10px]">
                  <Icon icon={CTX_ICON[c.kind]} width="10" class="shrink-0 text-neutral-400" />
                  <span class="truncate max-w-[120px]">{c.label}</span>
                  <button
                    type="button"
                    class="shrink-0 text-neutral-400 hover:text-neutral-700 cursor-pointer flex items-center"
                    title="Remove from context"
                    onClick={() => removeChip(c)}
                  >
                    <Icon icon="iconoir:xmark" width="10" />
                  </button>
                </span>
              )}
            </For>

            <NavMenu
              anchor="top"
              panelClass="w-56 max-h-72 overflow-y-auto py-1"
              trigger={({ toggle }) => (
                <button
                  type="button"
                  title="Add context"
                  aria-label="Add context"
                  class="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-neutral-500 hover:text-neutral-800 hover:bg-neutral-100 cursor-pointer"
                  onClick={() => {
                    setAddTick(t => t + 1);
                    toggle();
                  }}
                >
                  <Icon icon="iconoir:plus" width="11" /> Add
                </button>
              )}
            >
              {({ close }) => (
                <Show
                  when={!addData.loading}
                  fallback={<p class="px-3 py-2 text-xs text-neutral-400">Loading…</p>}
                >
                  <p class="px-2 pt-1 pb-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-400">
                    Entities
                  </p>
                  <For
                    each={addData()?.entities ?? []}
                    fallback={<p class="px-3 py-1 text-[11px] text-neutral-400">None</p>}
                  >
                    {e => (
                      <button
                        type="button"
                        disabled={presentKeys().has(`entity:${e.id}`)}
                        class="w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs text-neutral-700 enabled:hover:bg-neutral-50 enabled:cursor-pointer disabled:opacity-40"
                        onClick={() => {
                          addChip({ kind: "entity", id: e.id, label: e.name });
                          close();
                        }}
                      >
                        <Icon icon="iconoir:building" width="12" class="shrink-0 text-neutral-400" />
                        <span class="flex-1 truncate">{e.name}</span>
                      </button>
                    )}
                  </For>
                  <p class="px-2 pt-1.5 pb-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-400">
                    Projects
                  </p>
                  <For
                    each={addData()?.projects ?? []}
                    fallback={<p class="px-3 py-1 text-[11px] text-neutral-400">None</p>}
                  >
                    {p => (
                      <button
                        type="button"
                        disabled={presentKeys().has(`project:${p.id}`)}
                        class="w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs text-neutral-700 enabled:hover:bg-neutral-50 enabled:cursor-pointer disabled:opacity-40"
                        onClick={() => {
                          addChip({ kind: "project", id: p.id, label: p.name });
                          close();
                        }}
                      >
                        <Icon icon="iconoir:folder" width="12" class="shrink-0 text-neutral-400" />
                        <span class="flex-1 truncate">{p.name}</span>
                      </button>
                    )}
                  </For>
                </Show>
              )}
            </NavMenu>

            <Show when={chips().length > 0}>
              <button
                type="button"
                class="text-[10px] text-neutral-400 hover:text-neutral-700 cursor-pointer"
                title="Clear all context"
                onClick={clearChips}
              >
                Clear
              </button>
            </Show>
          </div>

          <form
            class="rounded-lg border border-neutral-200 bg-canvas focus-within:border-sky-500 transition-colors"
            onSubmit={e => {
              e.preventDefault();
              void chat.send();
            }}
          >
            <textarea
              rows="1"
              value={chat.input()}
              disabled={chat.busy()}
              placeholder="Ask anything…"
              onInput={e => {
                chat.setInput(e.currentTarget.value);
                e.currentTarget.style.height = "auto";
                e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 168)}px`;
              }}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void chat.send();
                }
              }}
              class="block w-full resize-none bg-transparent px-2.5 pt-2 pb-1 text-sm leading-relaxed outline-none placeholder:text-neutral-400 disabled:opacity-60"
            />
            <div class="flex items-center justify-between px-1.5 pb-1.5">
              <span class="pl-1 text-[10px] text-neutral-400 select-none">
                <Show when={!chat.busy()} fallback="Working…">
                  ⏎ send · ⇧⏎ newline
                </Show>
              </span>
              <Show
                when={!chat.busy()}
                fallback={
                  <button
                    type="button"
                    onClick={chat.stop}
                    title="Stop"
                    aria-label="Stop"
                    class="w-6 h-6 grid place-items-center rounded-md text-neutral-500 hover:text-neutral-800 hover:bg-neutral-100 transition-colors"
                  >
                    <Icon icon="iconoir:square" width="12" />
                  </button>
                }
              >
                <button
                  type="submit"
                  disabled={!chat.input().trim()}
                  title="Send"
                  aria-label="Send"
                  class="w-6 h-6 grid place-items-center rounded-md text-neutral-500 enabled:hover:text-neutral-800 enabled:hover:bg-neutral-100 disabled:opacity-30 transition-colors"
                >
                  <Icon icon="iconoir:arrow-up" width="14" />
                </button>
              </Show>
            </div>
          </form>
        </div>
      </div>
    </Show>
  );
}
