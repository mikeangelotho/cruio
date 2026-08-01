import { For, Show, createEffect } from "solid-js";
import { Icon } from "@iconify-icon/solid";
import type { Annotation, AnnotationStatus } from "../lib/types";
import { Avatar } from "./Avatar";

function timeAgo(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function ThreadSidebar(props: {
  annotations: Annotation[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onComment: (annotationId: string, body: string) => void;
  onResolve: (annotationId: string, status: AnnotationStatus) => void;
}) {
  let composerRef: HTMLTextAreaElement | undefined;

  // focus the composer whenever a thread is selected
  createEffect(() => {
    if (props.selectedId) queueMicrotask(() => composerRef?.focus());
  });

  const open = () => props.annotations.filter(a => a.status === "open");

  function submit(a: Annotation, el: HTMLTextAreaElement) {
    const body = el.value.trim();
    if (!body) return;
    props.onComment(a.id, body);
    el.value = "";
  }

  return (
    <aside class="w-80 shrink-0 h-full flex flex-col border-l border-neutral-200 bg-panel/95 backdrop-blur-sm">
      <div class="h-10 px-3 flex items-center justify-between border-b border-neutral-100">
        <span class="text-xs font-semibold text-neutral-700">
          Threads
          <Show when={props.annotations.length > 0}>
            <span class="ml-1.5 text-neutral-400 font-normal">
              {open().length} open · {props.annotations.length} total
            </span>
          </Show>
        </span>
        <span class="text-[10px] text-neutral-400">Tab to hide</span>
      </div>

      <div class="flex-1 overflow-y-auto">
        <Show
          when={props.annotations.length > 0}
          fallback={
            <div class="p-4 text-xs text-neutral-400 leading-relaxed">
              <p class="mb-2 font-medium text-neutral-500">No threads on this version.</p>
              <p>
                Click anywhere on the image to place a pin and start a thread — there is no
                annotation mode.
              </p>
            </div>
          }
        >
          <For each={props.annotations}>
            {(a, i) => {
              const selected = () => props.selectedId === a.id;
              return (
                <div
                  class="border-b border-neutral-100 cursor-pointer"
                  classList={{ "bg-sky-50/50": selected() }}
                  onClick={() => props.onSelect(selected() ? null : a.id)}
                >
                  <div class="px-3 py-2 flex items-start gap-2">
                    <span
                      class="mt-0.5 size-5 shrink-0 rounded-full rounded-bl-none flex items-center justify-center text-[10px] font-semibold text-white"
                      classList={{
                        "bg-orange-500": a.status === "open",
                        "bg-emerald-500": a.status === "resolved_approved",
                        "bg-neutral-400": a.status === "resolved_revision",
                      }}
                    >
                      {i() + 1}
                    </span>
                    <div class="min-w-0 flex-1">
                      <Show
                        when={a.comments.length > 0}
                        fallback={<p class="text-xs text-neutral-400 italic">New thread…</p>}
                      >
                        <p class="text-xs text-neutral-700 truncate flex items-center gap-1.5">
                          <Avatar name={a.comments[0].authorName} size={16} />
                          <span class="truncate">
                            <span class="font-medium">{a.comments[0].authorName}</span>{" "}
                            {a.comments[0].body}
                          </span>
                        </p>
                      </Show>
                      <p class="text-[10px] text-neutral-400 mt-0.5">
                        {a.status === "open"
                          ? timeAgo(a.createdAt)
                          : a.status === "resolved_approved"
                            ? "Resolved — approved"
                            : "Resolved — needs revision"}
                        <Show when={a.comments.length > 1}>
                          <span> · {a.comments.length} comments</span>
                        </Show>
                      </p>
                    </div>
                  </div>

                  <Show when={selected()}>
                    <div class="px-3 pb-3" onClick={e => e.stopPropagation()}>
                      <Show when={a.comments.length > 1}>
                        <div class="ml-7 mb-2 space-y-1.5">
                          <For each={a.comments.slice(1)}>
                            {c => (
                              <p class="text-xs text-neutral-700 flex items-start gap-1.5">
                                <Avatar name={c.authorName} size={16} />
                                <span>
                                  <span class="font-medium">{c.authorName}</span> {c.body}
                                </span>
                              </p>
                            )}
                          </For>
                        </div>
                      </Show>

                      <div class="ml-7 flex flex-col gap-1.5">
                          <textarea
                            ref={el => {
                              if (selected()) composerRef = el;
                            }}
                            rows="2"
                            class="w-full text-xs border border-neutral-200 rounded px-2 py-1.5 outline-none focus:border-sky-400 resize-none"
                            placeholder={
                              a.comments.length === 0 ? "Describe the issue or note…" : "Reply…"
                            }
                            onKeyDown={e => {
                              e.stopPropagation();
                              if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                submit(a, e.currentTarget as HTMLTextAreaElement);
                              }
                              if (e.key === "Escape") props.onSelect(null);
                            }}
                          />
                          <Show when={a.status === "open"}>
                            <div class="flex gap-1.5">
                              <button
                                class="flex-1 flex items-center justify-center gap-1 text-[11px] rounded border border-emerald-200 bg-emerald-50 text-emerald-700 py-1 hover:bg-emerald-100 cursor-pointer"
                                title="Resolve — approved"
                                onClick={() => props.onResolve(a.id, "resolved_approved")}
                              >
                                <Icon icon="iconoir:check" width="12" /> Approved
                              </button>
                              <button
                                class="flex-1 flex items-center justify-center gap-1 text-[11px] rounded border border-amber-200 bg-amber-50 text-amber-700 py-1 hover:bg-amber-100 cursor-pointer"
                                title="Resolve — needs revision"
                                onClick={() => props.onResolve(a.id, "resolved_revision")}
                              >
                                <Icon icon="iconoir:refresh" width="12" /> Needs revision
                              </button>
                            </div>
                          </Show>
                          <Show when={a.status !== "open"}>
                            <button
                              class="text-[11px] text-neutral-500 hover:text-neutral-700 self-start cursor-pointer"
                              onClick={() => props.onResolve(a.id, "open")}
                            >
                              Reopen thread
                            </button>
                          </Show>
                        </div>
                    </div>
                  </Show>
                </div>
              );
            }}
          </For>
        </Show>
      </div>
    </aside>
  );
}
