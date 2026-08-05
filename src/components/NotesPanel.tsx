import { For, Show } from "solid-js";
import { Icon } from "@iconify-icon/solid";
import type { CanvasObject } from "../lib/types";
import { NOTE_COLORS } from "./StickyNote";
import { Avatar } from "./Avatar";

function timeAgo(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/**
 * All sticky notes in the project, list-style — the notes equivalent of
 * HistoryPanel. Notes have no detail view of their own (they live on the
 * board), so a row's primary action is "fly the camera to it".
 */
export function NotesPanel(props: {
  notes: CanvasObject[];
  canDelete: boolean;
  onClose: () => void;
  onJumpTo: (note: CanvasObject) => void;
  onDelete: (note: CanvasObject) => void;
}) {
  const sorted = () => [...props.notes].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <aside class="absolute inset-y-0 right-0 z-20 w-[85vw] max-w-sm shadow-xl sm:static sm:z-auto sm:w-80 sm:max-w-none sm:shadow-none sm:shrink-0 h-full flex flex-col border-l border-neutral-200 bg-panel/95 backdrop-blur-sm">
      <div class="h-10 px-3 flex items-center justify-between border-b border-neutral-100">
        <span class="text-xs font-semibold text-neutral-700">Sticky notes</span>
        <button
          class="text-[10px] text-neutral-400 hover:text-neutral-700 cursor-pointer"
          onClick={props.onClose}
        >
          Close
        </button>
      </div>

      <div class="flex-1 overflow-y-auto">
        <Show
          when={sorted().length > 0}
          fallback={
            <p class="p-4 text-xs text-neutral-400">
              No sticky notes yet — press S or use the board toolbar to add one.
            </p>
          }
        >
          <For each={sorted()}>
            {n => (
              <div class="group px-3 py-2.5 border-b border-neutral-100 flex items-start gap-2">
                <button
                  class="min-w-0 flex-1 text-left cursor-pointer"
                  title="Jump to this note on the board"
                  onClick={() => props.onJumpTo(n)}
                >
                  <div class="flex items-start gap-2">
                    <span
                      class={`shrink-0 mt-0.5 size-2.5 rounded-sm ${(NOTE_COLORS[n.color] ?? NOTE_COLORS.yellow).swatch}`}
                    />
                    <p class="min-w-0 flex-1 text-xs text-neutral-700 leading-snug line-clamp-3">
                      {n.content || <span class="text-neutral-400 italic">Empty note</span>}
                    </p>
                  </div>
                  <Show when={n.tags.length > 0}>
                    <div class="mt-1.5 ml-4 flex flex-wrap gap-1">
                      <For each={n.tags}>
                        {t => (
                          <span class="text-[9px] text-neutral-500 bg-neutral-100 rounded px-1.5 py-px">
                            {t}
                          </span>
                        )}
                      </For>
                    </div>
                  </Show>
                  <div class="mt-1.5 ml-4 flex items-center gap-1.5 text-[10px] text-neutral-400">
                    <Avatar name={n.createdByName || "?"} size={14} />
                    <span class="truncate">{n.createdByName || "Someone"}</span>
                    <span>·</span>
                    <span class="shrink-0">{timeAgo(n.createdAt)}</span>
                  </div>
                </button>
                <Show when={props.canDelete}>
                  <button
                    class="shrink-0 p-1 rounded text-neutral-300 opacity-0 group-hover:opacity-100 hover:text-rose-600 hover:bg-accent-rose cursor-pointer"
                    title="Delete note"
                    onClick={() => props.onDelete(n)}
                  >
                    <Icon icon="iconoir:trash" width="12" />
                  </button>
                </Show>
              </div>
            )}
          </For>
        </Show>
      </div>
    </aside>
  );
}
