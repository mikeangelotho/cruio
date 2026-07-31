import { Show, type JSX } from "solid-js";
import { Icon } from "@iconify-icon/solid";

const TONES = {
  info: { wrap: "bg-sky-50 border-sky-200 text-sky-800", icon: "text-sky-500" },
  warn: { wrap: "bg-amber-50 border-amber-200 text-amber-800", icon: "text-amber-500" },
} as const;

/**
 * A small tinted inline banner for empty/lopsided states (e.g. "tasks but no
 * deliverables"). Content goes in children; an optional `actions` slot is
 * right-aligned for CTAs.
 */
export function Callout(props: {
  tone?: keyof typeof TONES;
  icon?: string;
  actions?: JSX.Element;
  children: JSX.Element;
}) {
  const tone = () => TONES[props.tone ?? "info"];
  return (
    <div class={`flex items-center gap-2.5 border rounded-lg px-3 py-2 text-xs ${tone().wrap}`}>
      <Show when={props.icon}>
        <Icon icon={props.icon!} width="16" class={`shrink-0 ${tone().icon}`} />
      </Show>
      <div class="min-w-0 flex-1 leading-snug">{props.children}</div>
      <Show when={props.actions}>
        <div class="shrink-0 flex items-center gap-1.5">{props.actions}</div>
      </Show>
    </div>
  );
}
