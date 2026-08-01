import { For, Show, createSignal } from "solid-js";
import type { CanvasObject, NoteColor } from "../lib/types";

export const NOTE_COLORS: Record<NoteColor, { bg: string; border: string; swatch: string }> = {
  yellow: { bg: "bg-amber-100", border: "border-amber-200", swatch: "bg-amber-300" },
  pink: { bg: "bg-pink-100", border: "border-pink-200", swatch: "bg-pink-300" },
  blue: { bg: "bg-sky-100", border: "border-sky-200", swatch: "bg-sky-300" },
  green: { bg: "bg-emerald-100", border: "border-emerald-200", swatch: "bg-emerald-300" },
};

export const NOTE_W = 180;

/**
 * A sticky note on the project board. Same drag/click conventions as
 * DeliverableCard: 4px pointer threshold separates drag from click,
 * double-click edits in place. Board-only — never mirrored to the library.
 */
export function StickyNote(props: {
  o: CanvasObject;
  /** effective on-screen position — sync or personal layer, resolved by the caller */
  x: number;
  y: number;
  onMove: (o: CanvasObject, x: number, y: number, done: boolean) => void;
  onEdit: (o: CanvasObject, content: string) => void;
  /** open the shared context menu at screen coords (right-click) */
  onMenu?: (o: CanvasObject, x: number, y: number) => void;
  /** convert a screen delta to a world delta (depends on zoom) */
  screenToWorldDelta: (dx: number, dy: number) => { x: number; y: number };
  /** start in edit mode (freshly placed note) */
  autoEdit?: boolean;
  readOnly?: boolean;
}) {
  const [editing, setEditing] = createSignal(props.autoEdit ?? false);

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0 || editing()) return;
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);

    const startX = e.clientX;
    const startY = e.clientY;
    const origX = props.x;
    const origY = props.y;
    let dragged = false;

    const onMove = (ev: PointerEvent) => {
      if (props.readOnly) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!dragged && Math.hypot(dx, dy) < 4) return;
      dragged = true;
      const wd = props.screenToWorldDelta(dx, dy);
      props.onMove(props.o, origX + wd.x, origY + wd.y, false);
    };
    const onUp = (ev: PointerEvent) => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.releasePointerCapture(ev.pointerId);
      if (dragged) {
        const wd = props.screenToWorldDelta(ev.clientX - startX, ev.clientY - startY);
        props.onMove(props.o, origX + wd.x, origY + wd.y, true);
      }
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
  }

  const palette = () => NOTE_COLORS[props.o.color] ?? NOTE_COLORS.yellow;

  return (
    <div
      data-note={props.o.id}
      class={`absolute select-none rounded-md border shadow-[0_2px_8px_rgba(0,0,0,0.08)] cursor-default ${palette().bg} ${palette().border}`}
      style={{
        left: `${props.x}px`,
        top: `${props.y}px`,
        width: `${NOTE_W}px`,
        "min-height": "64px",
      }}
      onPointerDown={onPointerDown}
      onDblClick={e => {
        e.stopPropagation();
        if (!props.readOnly) setEditing(true);
      }}
      onContextMenu={e => {
        e.preventDefault();
        e.stopPropagation();
        props.onMenu?.(props.o, e.clientX, e.clientY);
      }}
    >
      <Show
        when={!editing()}
        fallback={
          <textarea
            class="w-full min-h-16 text-xs text-neutral-800 bg-transparent outline-none resize-none p-2.5 select-text"
            value={props.o.content}
            ref={el => queueMicrotask(() => { el.focus(); el.select(); })}
            onPointerDown={e => e.stopPropagation()}
            onKeyDown={e => {
              e.stopPropagation();
              if (e.key === "Escape") {
                (e.currentTarget as HTMLTextAreaElement).value = props.o.content;
                (e.currentTarget as HTMLTextAreaElement).blur();
              }
            }}
            onBlur={e => {
              setEditing(false);
              const content = e.currentTarget.value;
              if (content !== props.o.content) props.onEdit(props.o, content);
            }}
          />
        }
      >
        <p
          class="text-xs text-neutral-800 whitespace-pre-wrap break-words p-2.5 pb-1"
          classList={{ "text-neutral-400 italic": !props.o.content }}
          title={props.readOnly ? undefined : "Double-click to edit"}
        >
          {props.o.content || "Empty note — double-click to write"}
        </p>
        <Show when={props.o.tags.length > 0}>
          <div class="px-2.5 pb-1 flex flex-wrap gap-1">
            <For each={props.o.tags}>
              {t => (
                <span class="text-[9px] text-neutral-600 bg-panel/60 rounded px-1 py-px">{t}</span>
              )}
            </For>
          </div>
        </Show>
        <p class="px-2.5 pb-1.5 text-[9px] text-neutral-500 truncate">
          {props.o.createdByName || "Someone"}
        </p>
      </Show>
    </div>
  );
}
