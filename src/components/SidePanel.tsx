import type { JSX } from "solid-js";

/**
 * Shared right-sidebar wrapper for the canvas dock panels (tasks, library,
 * metadata, …). An absolute slide-over on mobile, a static in-layout column
 * from `sm` up — the class string was previously copy-pasted across panels.
 */
export function SidePanel(props: { class?: string; children: JSX.Element }) {
  return (
    <aside
      class={`absolute inset-y-0 right-0 z-20 w-[85vw] max-w-sm shadow-xl sm:static sm:z-auto sm:w-80 sm:max-w-none sm:shadow-none sm:shrink-0 h-full flex flex-col border-l border-neutral-200 bg-panel/95 backdrop-blur-sm ${props.class ?? ""}`}
    >
      {props.children}
    </aside>
  );
}
