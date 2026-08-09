import { Icon } from "@iconify-icon/solid";
import { For } from "solid-js";

/**
 * Post-turn "recommended next steps", grouped into one card rather than a loose
 * row of text buttons. The model emits these as a trailing `Next: a | b | c`
 * line (see prompt.ts) and useChat/hydrate parse them off. Clicking a row sends
 * it as a chat prompt via `onPick` — it never executes a tool directly, so
 * there's no destructive action hidden behind a single click.
 */
export function RecommendedActions(props: {
  items: string[];
  onPick: (text: string) => void;
}) {
  return (
    <div
      class="mt-1 overflow-hidden rounded-lg border border-line bg-surface"
      role="group"
      aria-label="Suggested next steps"
    >
      <div class="flex items-center gap-1.5 px-3 pt-2 pb-1 text-[10px] font-medium uppercase tracking-wide text-neutral-400">
        <Icon icon="iconoir:sparks" width="12" aria-hidden="true" />
        Suggested next steps
      </div>
      <ul class="pb-1">
        <For each={props.items}>
          {s => (
            <li>
              <button
                type="button"
                onClick={() => props.onPick(s)}
                class="group flex min-h-[40px] w-full items-center gap-2 px-3 py-2 text-left text-sm text-neutral-700 transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
              >
                <Icon
                  icon="iconoir:arrow-right"
                  width="14"
                  class="shrink-0 text-neutral-400 transition-colors group-hover:text-brand"
                  aria-hidden="true"
                />
                <span class="min-w-0 break-words">{s}</span>
              </button>
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}
