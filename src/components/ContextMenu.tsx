import { For, Show, onCleanup, onMount } from "solid-js";
import { Icon } from "@iconify-icon/solid";

export type MenuEntry =
  | {
      label: string;
      icon: string;
      hint?: string;
      danger?: boolean;
      /** Non-actionable, muted row — used to explain why an action isn't
       *  available (e.g. project folders follow their project). `run` is
       *  ignored; provide `hint` for the short reason. */
      disabled?: boolean;
      run?: () => void;
    }
  | { separator: true };

export interface MenuState {
  x: number;
  y: number;
  entries: MenuEntry[];
}

const MENU_W = 208;
const ROW_H = 30;

/**
 * The one context menu used across the app — project cards, deliverable
 * cards, the canvas, version tabs. Open via right-click or a ⋯ button; every
 * surface offers the same look, hints, and permission-gated entries.
 */
export function ContextMenu(props: { state: MenuState | null; onClose: () => void }) {
  function onKey(e: KeyboardEvent) {
    // only intercept Escape while a menu is actually open — otherwise this
    // global capture-phase listener would swallow Escape for every other
    // Escape-driven UI on the page (search, dialogs, etc.)
    if (e.key === "Escape" && props.state) {
      e.stopPropagation();
      props.onClose();
    }
  }
  onMount(() => {
    window.addEventListener("keydown", onKey, true);
    onCleanup(() => window.removeEventListener("keydown", onKey, true));
  });

  const pos = () => {
    const s = props.state!;
    const items = s.entries.filter(e => !("separator" in e)).length;
    const h = items * ROW_H + 12;
    return {
      x: Math.min(s.x, window.innerWidth - MENU_W - 8),
      y: Math.min(s.y, window.innerHeight - h - 8),
    };
  };

  return (
    <Show when={props.state}>
      <div
        class="fixed inset-0 z-50"
        onClick={props.onClose}
        onContextMenu={e => {
          e.preventDefault();
          props.onClose();
        }}
      >
        <div
          class="absolute bg-panel border border-neutral-200 rounded-lg shadow-xl py-1 select-none"
          style={{ left: `${pos().x}px`, top: `${pos().y}px`, width: `${MENU_W}px` }}
          onClick={e => e.stopPropagation()}
        >
          <For each={props.state!.entries}>
            {entry =>
              "separator" in entry ? (
                <div class="my-1 border-t border-neutral-100" />
              ) : entry.disabled ? (
                <div
                  class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-neutral-400 cursor-default"
                  aria-disabled="true"
                >
                  <Icon icon={entry.icon} width="13" class="text-neutral-300" />
                  <span class="flex-1 truncate">{entry.label}</span>
                  <Show when={entry.hint}>
                    <span class="text-[10px] text-neutral-400">{entry.hint}</span>
                  </Show>
                </div>
              ) : (
                <button
                  class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs cursor-pointer"
                  classList={{
                    "text-neutral-700 hover:bg-neutral-100": !entry.danger,
                    "text-rose-600 hover:bg-accent-rose": entry.danger,
                  }}
                  onClick={() => {
                    props.onClose();
                    entry.run?.();
                  }}
                >
                  <Icon
                    icon={entry.icon}
                    width="13"
                    class={entry.danger ? "text-rose-400" : "text-neutral-400"}
                  />
                  <span class="flex-1 truncate">{entry.label}</span>
                  <Show when={entry.hint}>
                    <span class="text-[10px] text-neutral-400 bg-neutral-100 rounded px-1 py-0.5">
                      {entry.hint}
                    </span>
                  </Show>
                </button>
              )
            }
          </For>
        </div>
      </div>
    </Show>
  );
}
