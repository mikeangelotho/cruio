import { Show, createSignal, onCleanup, onMount, type JSX } from "solid-js";

/**
 * Shared anchored dropdown for the nav — org switcher, entity switcher, user
 * menu. Owns its own open state and closes on outside click or Escape, so
 * every instance behaves the same regardless of where it's mounted (no
 * reliance on an ancestor's onClick to sweep up stray open menus).
 */
export function NavMenu(props: {
  trigger: (ctx: { open: () => boolean; toggle: () => void }) => JSX.Element;
  children: (ctx: { close: () => void }) => JSX.Element;
  /** Which edge of the trigger the panel drops from. Default "bottom". */
  anchor?: "bottom" | "top";
  align?: "left" | "right";
  panelClass?: string;
}) {
  const [open, setOpen] = createSignal(false);
  let ref: HTMLDivElement | undefined;
  const close = () => setOpen(false);
  const toggle = () => setOpen(v => !v);

  function onDocPointerDown(e: PointerEvent) {
    if (ref && e.target instanceof Node && !ref.contains(e.target)) close();
  }
  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") close();
  }
  onMount(() => {
    document.addEventListener("pointerdown", onDocPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    onCleanup(() => {
      document.removeEventListener("pointerdown", onDocPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    });
  });

  return (
    <div class="relative" ref={ref}>
      {props.trigger({ open, toggle })}
      <Show when={open()}>
        <div
          class={`absolute z-30 bg-white border border-neutral-200 rounded-lg shadow-xl ${
            props.anchor === "top" ? "bottom-full mb-1" : "top-full mt-1"
          } ${props.align === "right" ? "right-0" : "left-0"} ${props.panelClass ?? "w-52"}`}
        >
          {props.children({ close })}
        </div>
      </Show>
    </div>
  );
}
