import { For, Show } from "solid-js";
import { Icon } from "@iconify-icon/solid";
import { NavMenu } from "./NavMenu";
import { TAG_COLORS } from "./TagChips";
import type { Tag } from "../lib/types";

/** A segmented control (e.g. List / Board). */
export interface SegmentedControl {
  value: string;
  options: { value: string; label: string; icon?: string }[];
  onChange: (value: string) => void;
}
/** A "Label: Value" dropdown (e.g. Sort, Group). */
export interface FilterMenu {
  icon?: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  /** hide this menu without removing it (e.g. Group only in list view) */
  show?: boolean;
  panelClass?: string;
}
/** A boolean pill toggle (e.g. My tasks, Overdue). */
export interface FilterToggle {
  label: string;
  active: boolean;
  onToggle: () => void;
  /** classes applied when active; defaults to sky */
  activeClass?: string;
}
/** Multiselect tag-filter chips. */
export interface TagFilter {
  all: Tag[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onClear: () => void;
}
/** A right-aligned search box. */
export interface SearchFilter {
  value: string;
  onInput: (value: string) => void;
  placeholder?: string;
}

/**
 * The shared filter/sort toolbar used by the Projects and Tasks screens (and
 * reusable elsewhere). It's one component; each screen passes only the controls
 * that make sense for it — a segmented control, "Label: Value" dropdowns,
 * boolean pill toggles, tag-filter chips, and/or a right-aligned search box —
 * so the bar looks and behaves consistently everywhere.
 */
export function FilterBar(props: {
  segmented?: SegmentedControl;
  menus?: FilterMenu[];
  toggles?: FilterToggle[];
  tags?: TagFilter;
  search?: SearchFilter;
}) {
  const menuLabel = (m: FilterMenu) => m.options.find(o => o.value === m.value)?.label;
  // whether any control precedes the tag chips (drives the divider before them)
  const hasControlsBeforeTags = () =>
    !!props.segmented ||
    (props.menus?.some(m => m.show !== false) ?? false) ||
    (props.toggles?.length ?? 0) > 0;

  return (
    <div class="flex items-center gap-2 mb-5 flex-wrap">
      <Show when={props.segmented}>
        {seg => (
          <div class="flex items-center bg-neutral-100 rounded-md p-0.5">
            <For each={seg().options}>
              {o => (
                <button
                  class="flex items-center gap-1 text-[11px] rounded px-2 py-1 cursor-pointer"
                  classList={{
                    "bg-white shadow-sm text-neutral-800": seg().value === o.value,
                    "text-neutral-500": seg().value !== o.value,
                  }}
                  onClick={() => seg().onChange(o.value)}
                >
                  <Show when={o.icon}>
                    <Icon icon={o.icon!} width="13" />
                  </Show>
                  {o.label}
                </button>
              )}
            </For>
          </div>
        )}
      </Show>

      <For each={props.menus ?? []}>
        {m => (
          <Show when={m.show !== false}>
            <NavMenu
              panelClass={m.panelClass ?? "w-36"}
              trigger={({ toggle }) => (
                <button
                  class="flex items-center gap-1 text-[11px] text-neutral-500 hover:bg-neutral-100 rounded-md px-2 py-1.5 cursor-pointer"
                  onClick={toggle}
                >
                  <Show when={m.icon}>
                    <Icon icon={m.icon!} width="13" />
                  </Show>
                  {m.label}: {menuLabel(m)}
                </button>
              )}
            >
              {({ close }) => (
                <div class="p-1">
                  <For each={m.options}>
                    {o => (
                      <button
                        class="w-full flex items-center justify-between px-2 py-1.5 rounded text-left text-xs text-neutral-700 hover:bg-neutral-50 cursor-pointer"
                        onClick={() => {
                          close();
                          m.onChange(o.value);
                        }}
                      >
                        {o.label}
                        <Show when={m.value === o.value}>
                          <Icon icon="iconoir:check" width="12" class="text-neutral-400" />
                        </Show>
                      </button>
                    )}
                  </For>
                </div>
              )}
            </NavMenu>
          </Show>
        )}
      </For>

      <For each={props.toggles ?? []}>
        {t => (
          <button
            class={`text-[11px] rounded-md px-2 py-1.5 cursor-pointer ${
              t.active
                ? (t.activeClass ?? "bg-sky-100 text-sky-700")
                : "text-neutral-500 hover:bg-neutral-100"
            }`}
            onClick={t.onToggle}
          >
            {t.label}
          </button>
        )}
      </For>

      <Show when={props.tags && props.tags.all.length > 0}>
        <Show when={hasControlsBeforeTags()}>
          <span class="w-px h-4 bg-neutral-200 shrink-0" />
        </Show>
        <div class="flex items-center gap-1 flex-wrap">
          <For each={props.tags!.all}>
            {t => (
              <button
                class={`inline-flex items-center gap-1 rounded-full text-[11px] font-medium px-2 py-0.5 cursor-pointer border ${
                  props.tags!.selected.has(t.id)
                    ? `${TAG_COLORS[t.color].chip} border-transparent`
                    : "border-neutral-200 text-neutral-500 hover:bg-neutral-50"
                }`}
                onClick={() => props.tags!.onToggle(t.id)}
              >
                <span class={`size-1.5 rounded-full ${TAG_COLORS[t.color].dot}`} />
                {t.name}
              </button>
            )}
          </For>
          <Show when={props.tags!.selected.size > 0}>
            <button
              class="text-[11px] text-neutral-400 hover:text-neutral-700 px-1 cursor-pointer"
              onClick={() => props.tags!.onClear()}
            >
              Clear
            </button>
          </Show>
        </div>
      </Show>

      <Show when={props.search}>
        {s => (
          <div class="flex-1 min-w-24 max-w-64 ml-auto relative">
            <Icon
              icon="iconoir:search"
              width="13"
              class="absolute left-2 top-1/2 -translate-y-1/2 text-neutral-300"
            />
            <input
              class="w-full text-[11px] bg-neutral-50 border border-neutral-200 rounded-md pl-6 pr-2 py-1.5 outline-none focus:border-sky-300 placeholder:text-neutral-400"
              placeholder={s().placeholder ?? "Filter…"}
              value={s().value}
              onInput={e => s().onInput(e.currentTarget.value)}
            />
          </div>
        )}
      </Show>
    </div>
  );
}
