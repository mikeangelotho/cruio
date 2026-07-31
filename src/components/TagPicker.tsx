import { For, Show, createSignal, type JSX } from "solid-js";
import { Icon } from "@iconify-icon/solid";
import type { Tag, TagColor } from "../lib/types";
import { NavMenu } from "./NavMenu";
import { TAG_COLORS, TAG_COLOR_KEYS } from "./TagChips";

/**
 * Multiselect tag picker over the org's shared tag list. Presentational: the
 * parent owns the single `listTags` fetch (`allTags`) and the create/refetch
 * (`onCreateTag`), so many pickers on one screen don't each hit the server.
 * Toggling a tag calls `onChange` with the full new selection (replace-set).
 */
export function TagPicker(props: {
  selected: Tag[];
  allTags: Tag[];
  onChange: (tags: Tag[]) => void;
  onCreateTag?: (name: string, color: TagColor) => Promise<Tag>;
  canManage?: boolean;
  trigger?: (ctx: { toggle: () => void }) => JSX.Element;
  align?: "left" | "right";
}) {
  const [draftColor, setDraftColor] = createSignal<TagColor>("neutral");
  const isSelected = (id: string) => props.selected.some(t => t.id === id);

  function toggle(tag: Tag) {
    if (isSelected(tag.id)) props.onChange(props.selected.filter(t => t.id !== tag.id));
    else props.onChange([...props.selected, tag]);
  }

  let createInput: HTMLInputElement | undefined;

  async function create(name: string) {
    const trimmed = name.trim();
    if (!trimmed || !props.onCreateTag) return;
    const tag = await props.onCreateTag(trimmed, draftColor());
    // avoid a double-add if the name matched an existing tag
    if (!isSelected(tag.id)) props.onChange([...props.selected, tag]);
  }

  function submitCreate() {
    if (!createInput) return;
    void create(createInput.value);
    createInput.value = "";
    createInput.focus();
  }

  return (
    <NavMenu
      align={props.align ?? "left"}
      panelClass="w-56"
      trigger={({ toggle: t }) =>
        props.trigger ? (
          props.trigger({ toggle: t })
        ) : (
          <button
            class="flex items-center gap-0.5 text-[10px] text-neutral-500 border border-dashed border-neutral-300 rounded-full px-1.5 py-0.5 hover:border-neutral-400 hover:text-neutral-700 hover:bg-neutral-50 cursor-pointer"
            title="Add tags"
            onClick={e => {
              e.stopPropagation();
              t();
            }}
          >
            <Icon icon="iconoir:plus" width="10" /> Tag
          </button>
        )
      }
    >
      {() => (
        <div class="p-1" onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
          <div class="max-h-52 overflow-y-auto">
            <For each={props.allTags}>
              {tag => (
                <button
                  class="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs text-neutral-700 hover:bg-neutral-50 cursor-pointer"
                  onClick={() => toggle(tag)}
                >
                  <span class={`size-2 rounded-full shrink-0 ${TAG_COLORS[tag.color].dot}`} />
                  <span class="flex-1 truncate">{tag.name}</span>
                  <Show when={isSelected(tag.id)}>
                    <Icon icon="iconoir:check" width="12" class="text-neutral-400" />
                  </Show>
                </button>
              )}
            </For>
            <Show when={props.allTags.length === 0}>
              <p class="px-2 py-2 text-[11px] text-neutral-400">No tags yet.</p>
            </Show>
          </div>

          <Show when={props.canManage && props.onCreateTag}>
            <div class="mt-1 pt-1.5 border-t border-neutral-100 px-1">
              <p class="mb-1 text-[10px] uppercase tracking-wide text-neutral-400">Color</p>
              <div class="flex items-center gap-1 mb-1.5">
                <For each={TAG_COLOR_KEYS}>
                  {c => (
                    <button
                      class="size-4 rounded-full cursor-pointer ring-offset-1"
                      classList={{ "ring-2 ring-neutral-400": draftColor() === c }}
                      title={TAG_COLORS[c].label}
                      onClick={() => setDraftColor(c)}
                    >
                      <span class={`block size-4 rounded-full ${TAG_COLORS[c].dot}`} />
                    </button>
                  )}
                </For>
              </div>
              <div class="flex items-center gap-1">
                <input
                  ref={el => (createInput = el)}
                  class="flex-1 min-w-0 text-xs border border-neutral-200 rounded px-1.5 py-1 outline-none focus:border-sky-400 placeholder:text-neutral-400"
                  placeholder="New tag name…"
                  onKeyDown={e => {
                    if (e.key === "Enter") submitCreate();
                  }}
                />
                <button
                  class="shrink-0 text-[11px] text-white bg-neutral-800 hover:bg-neutral-700 rounded px-2 py-1 cursor-pointer"
                  title="Create tag"
                  onClick={submitCreate}
                >
                  Create
                </button>
              </div>
            </div>
          </Show>
        </div>
      )}
    </NavMenu>
  );
}
