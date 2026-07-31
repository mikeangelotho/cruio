import { For, Show } from "solid-js";
import { Icon } from "@iconify-icon/solid";
import type { Tag, TagColor } from "../lib/types";

/** Shared tag color palette — chip (fill+text) and dot (swatch) classes. */
export const TAG_COLORS: Record<TagColor, { chip: string; dot: string; label: string }> = {
  neutral: { chip: "bg-neutral-100 text-neutral-600", dot: "bg-neutral-400", label: "Gray" },
  sky: { chip: "bg-sky-50 text-sky-700", dot: "bg-sky-500", label: "Blue" },
  emerald: { chip: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500", label: "Green" },
  amber: { chip: "bg-amber-50 text-amber-700", dot: "bg-amber-500", label: "Amber" },
  rose: { chip: "bg-rose-50 text-rose-700", dot: "bg-rose-500", label: "Rose" },
  violet: { chip: "bg-violet-50 text-violet-700", dot: "bg-violet-500", label: "Violet" },
};

export const TAG_COLOR_KEYS = Object.keys(TAG_COLORS) as TagColor[];

/** Read-only row of colored tag chips. `onRemove` adds an inline × per chip. */
export function TagChips(props: {
  tags: Tag[];
  size?: "xs" | "sm";
  onRemove?: (tag: Tag) => void;
  class?: string;
}) {
  const pad = () => (props.size === "sm" ? "text-[11px] px-1.5 py-0.5" : "text-[10px] px-1.5 py-px");
  return (
    <Show when={props.tags.length > 0}>
      <div class={`flex items-center gap-1 flex-wrap ${props.class ?? ""}`}>
        <For each={props.tags}>
          {t => (
            <span
              class={`inline-flex items-center gap-1 rounded-full font-medium ${pad()} ${TAG_COLORS[t.color].chip}`}
            >
              {t.name}
              <Show when={props.onRemove}>
                <button
                  class="opacity-60 hover:opacity-100 cursor-pointer"
                  title={`Remove ${t.name}`}
                  onPointerDown={e => e.stopPropagation()}
                  onClick={e => {
                    e.stopPropagation();
                    props.onRemove!(t);
                  }}
                >
                  <Icon icon="iconoir:xmark" width="9" />
                </button>
              </Show>
            </span>
          )}
        </For>
      </div>
    </Show>
  );
}
