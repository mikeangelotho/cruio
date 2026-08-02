import { createAsync, useLocation } from "@solidjs/router";
import { Icon } from "@iconify-icon/solid";
import { For, Show, createEffect, createMemo, createResource, createSignal, onCleanup, onMount } from "solid-js";
import { myOrgsQuery, sessionQuery } from "../../lib/org-api";
import { useViewerRole } from "../../lib/viewer";
import { useChat } from "../../lib/ai/useChat";
import { listMyConversations } from "../../lib/ai/conversations";
import { aiPanelOpen, closeAiPanel, toggleAiPanel } from "../../lib/ai/panelState";
import { timeAgo } from "../../lib/time";
import { NavMenu } from "../NavMenu";
import { MessageList } from "./MessageList";

const HIDDEN = ["/sign-in", "/sign-up", "/onboarding", "/invite"];

/** A short, no-fetch label for "what the user is looking at" — mirrors the
 *  route matching in src/lib/ai/prompt.ts:pageContext, but as a chip label
 *  rather than a sentence for the model. */
function pageLabel(pathname: string): { icon: string; text: string } | null {
  if (!pathname || pathname === "/") return { icon: "frame", text: "Projects" };
  if (pathname.startsWith("/p/")) {
    return pathname.includes("/d/")
      ? { icon: "eye-empty", text: "Reviewing" }
      : { icon: "page-star", text: "Project canvas" };
  }
  if (pathname.startsWith("/tasks")) return { icon: "check-square", text: "Tasks" };
  if (pathname.startsWith("/library")) return { icon: "folder", text: "Library" };
  if (pathname.startsWith("/settings")) return { icon: "settings", text: "Settings" };
  return null;
}

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
  const user = createAsync(() => sessionQuery());
  const orgs = createAsync(() => myOrgsQuery());
  const { isGuest } = useViewerRole(() => user() ?? undefined, () => orgs());
  const location = useLocation();

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
        closeAiPanel();
      }
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  const chat = useChat(() => location.pathname);
  const label = createMemo(() => pageLabel(location.pathname));

  // Refetched fresh each time the history menu opens, not cached — a bumped
  // source signal is simpler here than reasoning about a resource created
  // inside NavMenu's render-prop.
  const [historyTick, setHistoryTick] = createSignal(0);
  const [conversations] = createResource(historyTick, () => listMyConversations());

  // Guests get no AI surface at all — this gates both rendering and Ctrl+I.
  const allowed = createMemo(
    () => !!user() && !isGuest() && !HIDDEN.some(p => location.pathname.startsWith(p)),
  );

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
          <Show when={label()}>
            {l => (
              <span class="flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] text-neutral-500">
                <Icon icon={`iconoir:${l().icon}`} width="10" />
                {l().text}
              </span>
            )}
          </Show>
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
            onClick={closeAiPanel}
            title="Close"
            aria-label="Close assistant"
            class="w-6 h-6 grid place-items-center rounded-md text-neutral-500 hover:text-neutral-800 hover:bg-neutral-100 transition-colors"
          >
            <Icon icon="iconoir:xmark" width="14" />
          </button>
        </header>

        <MessageList chat={chat} />

        <div class="shrink-0 px-2.5 pb-2.5">
          <Show when={chat.error()}>
            <p class="mb-2 text-xs leading-snug rounded-md px-2 py-1.5 bg-accent-rose text-on-accent-rose">
              {chat.error()}
            </p>
          </Show>

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
