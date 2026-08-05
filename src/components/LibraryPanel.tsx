import { For, Show } from "solid-js";
import { A } from "@solidjs/router";
import { Icon } from "@iconify-icon/solid";
import type { LibraryFile } from "../lib/types";
import { fileUrl } from "../lib/types";

const isImage = (mime: string) => mime.startsWith("image/");

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * This project's library assets — its uploads and the version mirrors from its
 * deliverables — shown in the canvas right sidebar. A header link escapes to the
 * full workspace library; mirror rows jump back to their deliverable on canvas.
 */
export function LibraryPanel(props: {
  files: LibraryFile[];
  loading: boolean;
  projectId: string;
  onClose: () => void;
  onOpenMirror: (projectId: string, deliverableId: string) => void;
}) {
  const sorted = () => [...props.files].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <aside class="absolute inset-y-0 right-0 z-20 w-[85vw] max-w-sm shadow-xl sm:static sm:z-auto sm:w-80 sm:max-w-none sm:shadow-none sm:shrink-0 h-full flex flex-col border-l border-neutral-200 bg-panel/95 backdrop-blur-sm">
      <div class="h-10 px-3 flex items-center justify-between border-b border-neutral-100">
        <span class="text-xs font-semibold text-neutral-700">
          Library
          <Show when={props.files.length > 0}>
            <span class="ml-1.5 text-[10px] font-normal text-neutral-400">
              {props.files.length}
            </span>
          </Show>
        </span>
        <div class="flex items-center gap-2.5">
          <A
            href="/library"
            class="flex items-center gap-0.5 text-[10px] text-sky-700 hover:text-sky-900 cursor-pointer"
            title="Open the full library"
          >
            Open full library
            <Icon icon="iconoir:arrow-up-right" width="11" />
          </A>
          <button
            class="text-[10px] text-neutral-400 hover:text-neutral-700 cursor-pointer"
            onClick={props.onClose}
          >
            Close
          </button>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto">
        <Show
          when={!props.loading}
          fallback={<p class="p-4 text-xs text-neutral-400">Loading assets…</p>}
        >
          <Show
            when={sorted().length > 0}
            fallback={
              <p class="p-4 text-xs text-neutral-400">
                No assets in this project yet. Upload versions on the canvas and they'll appear here.
              </p>
            }
          >
            <For each={sorted()}>
              {f => {
                const thumb = () => (
                  <div class="shrink-0 size-10 rounded bg-neutral-100 overflow-hidden flex items-center justify-center">
                    <Show
                      when={isImage(f.mime)}
                      fallback={<Icon icon="iconoir:page" width="16" class="text-neutral-400" />}
                    >
                      <img
                        src={fileUrl(f.fileName)}
                        alt=""
                        class="w-full h-full object-cover"
                        draggable={false}
                      />
                    </Show>
                  </div>
                );
                const body = () => (
                  <div class="min-w-0 flex-1 text-left">
                    <p class="text-xs text-neutral-700 truncate">{f.name}</p>
                    <p class="mt-0.5 flex items-center gap-1.5 text-[10px] text-neutral-400">
                      <Show when={f.deliverableId}>
                        <span class="flex items-center gap-0.5 text-neutral-500">
                          <Icon icon="iconoir:media-image" width="10" /> mirror
                        </span>
                        <span>·</span>
                      </Show>
                      <span>{fmtSize(f.size)}</span>
                    </p>
                  </div>
                );
                return (
                  <div class="px-3 py-2 border-b border-neutral-100 hover:bg-neutral-50">
                    <Show
                      when={f.deliverableId}
                      fallback={
                        <A
                          href={`/library?folder=${f.folderId}&file=${f.id}`}
                          class="flex items-center gap-2.5 cursor-pointer"
                          title="Open in the library"
                        >
                          {thumb()}
                          {body()}
                        </A>
                      }
                    >
                      <button
                        class="w-full flex items-center gap-2.5 cursor-pointer"
                        title="Open this deliverable on the canvas"
                        onClick={() => props.onOpenMirror(props.projectId, f.deliverableId!)}
                      >
                        {thumb()}
                        {body()}
                      </button>
                    </Show>
                  </div>
                );
              }}
            </For>
          </Show>
        </Show>
      </div>
    </aside>
  );
}
