import { For, Show } from "solid-js";
import { Icon } from "@iconify-icon/solid";
import type { Tag, TagColor } from "../lib/types";

/** Shared tag color palette — chip (fill+text) and dot (swatch) classes.
 *  Chips are accent surface/ink pairs so they follow the theme; the dots stay
 *  saturated -500s, which read on both a light and a dark ground. */
export const TAG_COLORS: Record<TagColor, { chip: string; dot: string; label: string }> = {
  neutral: { chip: "bg-accent-neutral text-on-accent-neutral", dot: "bg-neutral-400", label: "Gray" },
  sky: { chip: "bg-accent-sky text-on-accent-sky", dot: "bg-sky-500", label: "Blue" },
  emerald: { chip: "bg-accent-emerald text-on-accent-emerald", dot: "bg-emerald-500", label: "Green" },
  amber: { chip: "bg-accent-amber text-on-accent-amber", dot: "bg-amber-500", label: "Amber" },
  rose: { chip: "bg-accent-rose text-on-accent-rose", dot: "bg-rose-500", label: "Rose" },
  violet: { chip: "bg-accent-violet text-on-accent-violet", dot: "bg-violet-500", label: "Violet" },
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
