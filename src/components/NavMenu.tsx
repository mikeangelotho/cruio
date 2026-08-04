import { Show, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import { Portal } from "solid-js/web";

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
  /** Render the panel in a Portal with fixed positioning so it can escape an
   * `overflow-hidden`/`overflow-clip` ancestor (e.g. a card). Off by default. */
  portal?: boolean;
}) {
  const [open, setOpen] = createSignal(false);
  let ref: HTMLDivElement | undefined;
  let panelRef: HTMLDivElement | undefined;
  const close = () => setOpen(false);
  const toggle = () => setOpen(v => !v);

  // Fixed-position coords for the portaled panel, measured from the trigger.
  const [pos, setPos] = createSignal<{ top: number; left: number; width: number } | null>(null);
  function reposition() {
    if (!ref) return;
    setPos({ top: ref.getBoundingClientRect().top, left: ref.getBoundingClientRect().left, width: ref.offsetWidth });
  }

  function onDocPointerDown(e: PointerEvent) {
    const t = e.target;
    if (!(t instanceof Node)) return;
    if (ref?.contains(t) || panelRef?.contains(t)) return;
    close();
  }
  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") close();
  }
  // A portaled panel is fixed-positioned; scrolling would leave it stranded, so
  // close on scroll (matches how the non-portal panel already moves with layout).
  function onScroll() {
    if (props.portal) close();
  }
  onMount(() => {
    document.addEventListener("pointerdown", onDocPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    onCleanup(() => {
      document.removeEventListener("pointerdown", onDocPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
    });
  });

  function handleToggle() {
    if (props.portal && !open()) reposition();
    toggle();
  }

  const panelBase = "z-30 bg-panel border border-neutral-200 rounded-lg shadow-xl";

  return (
    <div class="relative" ref={ref}>
      {props.trigger({ open, toggle: handleToggle })}
      <Show when={open()}>
        <Show
          when={props.portal}
          fallback={
            <div
              class={`absolute ${panelBase} ${
                props.anchor === "top" ? "bottom-full mb-1" : "top-full mt-1"
              } ${props.align === "right" ? "right-0" : "left-0"} ${props.panelClass ?? "w-52"}`}
            >
              {props.children({ close })}
            </div>
          }
        >
          <Portal>
            <div
              ref={panelRef}
              class={`fixed ${panelBase} ${props.panelClass ?? "w-52"}`}
              style={{
                // anchor to the trigger's fixed-viewport rect
                ...(props.anchor === "top"
                  ? { bottom: `${window.innerHeight - (pos()?.top ?? 0) + 4}px` }
                  : { top: `${(pos()?.top ?? 0) + (ref?.offsetHeight ?? 0) + 4}px` }),
                ...(props.align === "right"
                  ? { left: `${(pos()?.left ?? 0) + (pos()?.width ?? 0)}px`, transform: "translateX(-100%)" }
                  : { left: `${pos()?.left ?? 0}px` }),
              }}
            >
              {props.children({ close })}
            </div>
          </Portal>
        </Show>
      </Show>
    </div>
  );
}
