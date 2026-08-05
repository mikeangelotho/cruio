import { For, Show, createResource, createSignal } from "solid-js";
import type { HistoryEntry } from "../lib/types";
import { listHistory, restoreDeliverable, restoreVersion } from "../lib/api";
import { timeAgo } from "../lib/time";
import { Avatar } from "./Avatar";

export function HistoryPanel(props: {
  projectId: string;
  canRestore: boolean;
  onClose: () => void;
  /** called after a successful restore so the canvas can reload the graph */
  onRestored: () => void;
}) {
  const [entries, { refetch }] = createResource(() => props.projectId, listHistory);
  const [busyId, setBusyId] = createSignal<string | null>(null);
  const [error, setError] = createSignal("");

  async function restore(e: HistoryEntry) {
    if (!e.subjectId) return;
    setBusyId(e.id);
    setError("");
    try {
      if (e.type === "version_deleted") await restoreVersion(e.subjectId);
      else await restoreDeliverable(e.subjectId);
      await refetch();
      props.onRestored();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <aside class="absolute inset-y-0 right-0 z-20 w-[85vw] max-w-sm shadow-xl sm:static sm:z-auto sm:w-80 sm:max-w-none sm:shadow-none sm:shrink-0 h-full flex flex-col border-l border-neutral-200 bg-panel/95 backdrop-blur-sm">
      <div class="h-10 px-3 flex items-center justify-between border-b border-neutral-100">
        <span class="text-xs font-semibold text-neutral-700">History</span>
        <button
          class="text-[10px] text-neutral-400 hover:text-neutral-700 cursor-pointer"
          onClick={props.onClose}
        >
          H to hide
        </button>
      </div>

      <div class="flex-1 overflow-y-auto">
        <Show when={error()}>
          <p class="m-3 text-xs text-on-accent-rose bg-accent-rose border border-accent-rose-line rounded px-2 py-1.5">
            {error()}
          </p>
        </Show>
        <Show
          when={(entries() ?? []).length > 0}
          fallback={
            <Show when={!entries.loading}>
              <p class="p-4 text-xs text-neutral-400">No activity yet.</p>
            </Show>
          }
        >
          <For each={entries()}>
            {e => (
              <div class="px-3 py-2 border-b border-neutral-100 flex items-start gap-2">
                <Avatar name={e.actorName} size={18} />
                <div class="min-w-0 flex-1">
                  <p class="text-xs text-neutral-700 leading-snug">
                    <span class="font-medium">{e.actorName}</span> {e.detail}
                  </p>
                  <p class="text-[10px] text-neutral-400 mt-0.5">{timeAgo(e.createdAt)}</p>
                  <Show when={e.restorable && props.canRestore}>
                    <button
                      class="mt-1 text-[11px] text-on-accent-sky border border-accent-sky-line bg-accent-sky rounded px-2 py-0.5 hover:bg-accent-sky-hover cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      disabled={busyId() === e.id}
                      onClick={() => void restore(e)}
                    >
                      {busyId() === e.id ? "Restoring…" : "Restore"}
                    </button>
                  </Show>
                </div>
              </div>
            )}
          </For>
        </Show>
      </div>
    </aside>
  );
}
