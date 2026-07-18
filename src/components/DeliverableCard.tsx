import { Show, createSignal } from "solid-js";
import { Icon } from "@iconify-icon/solid";
import type { Deliverable } from "../lib/types";
import { fileUrl } from "../lib/types";
import { CARD_W, thumbHeight } from "../lib/canvas/geometry";

export const STATUS_META: Record<
  Deliverable["status"],
  { label: string; chip: string; dot: string }
> = {
  draft: { label: "Draft", chip: "bg-neutral-100 text-neutral-500", dot: "bg-neutral-400" },
  in_review: { label: "In review", chip: "bg-sky-50 text-sky-700", dot: "bg-sky-500" },
  revisions_requested: { label: "Revisions", chip: "bg-amber-50 text-amber-700", dot: "bg-amber-500" },
  approved: { label: "Approved", chip: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
};

export function DeliverableCard(props: {
  d: Deliverable;
  onOpen: (d: Deliverable) => void;
  onMove: (d: Deliverable, x: number, y: number, done: boolean) => void;
  onRename: (d: Deliverable, name: string) => void;
  /** convert a screen delta to a world delta (depends on zoom) */
  screenToWorldDelta: (dx: number, dy: number) => { x: number; y: number };
  hidden?: boolean;
}) {
  const [editing, setEditing] = createSignal(false);
  const latest = () => props.d.versions[props.d.versions.length - 1];
  const openThreads = () => props.d.annotations.filter(a => a.status === "open").length;

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0 || editing()) return;
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);

    const startX = e.clientX;
    const startY = e.clientY;
    const origX = props.d.posX;
    const origY = props.d.posY;
    let dragged = false;

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!dragged && Math.hypot(dx, dy) < 4) return;
      dragged = true;
      const wd = props.screenToWorldDelta(dx, dy);
      props.onMove(props.d, origX + wd.x, origY + wd.y, false);
    };
    const onUp = (ev: PointerEvent) => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.releasePointerCapture(ev.pointerId);
      if (dragged) {
        const wd = props.screenToWorldDelta(ev.clientX - startX, ev.clientY - startY);
        props.onMove(props.d, origX + wd.x, origY + wd.y, true);
      } else {
        props.onOpen(props.d);
      }
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
  }

  return (
    <div
      data-card={props.d.id}
      class="absolute select-none rounded-lg bg-white border border-neutral-200 shadow-[0_1px_4px_rgba(0,0,0,0.06)] hover:shadow-[0_2px_10px_rgba(0,0,0,0.10)] hover:border-neutral-300 transition-shadow cursor-default outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
      style={{
        left: `${props.d.posX}px`,
        top: `${props.d.posY}px`,
        width: `${CARD_W}px`,
        display: props.hidden ? "none" : undefined,
      }}
      tabindex="0"
      onPointerDown={onPointerDown}
      onKeyDown={e => {
        if (e.key === "Enter" && !editing()) {
          e.preventDefault();
          props.onOpen(props.d);
        }
      }}
    >
      <div
        class="overflow-hidden rounded-t-lg bg-neutral-50 flex items-center justify-center"
        style={{ height: `${thumbHeight(props.d)}px` }}
      >
        <Show
          when={latest()}
          fallback={
            <div class="flex flex-col items-center gap-1 text-neutral-300">
              <Icon icon="iconoir:media-image" width="24" />
              <span class="text-[10px]">Drop an image</span>
            </div>
          }
        >
          {v => (
            <img
              src={fileUrl(v().fileName)}
              alt={props.d.name}
              class="w-full h-full object-cover pointer-events-none"
              draggable={false}
            />
          )}
        </Show>
      </div>

      <div class="h-11 px-2.5 flex items-center justify-between gap-2">
        <Show
          when={!editing()}
          fallback={
            <input
              class="text-xs font-medium bg-neutral-50 border border-neutral-200 rounded px-1 py-0.5 w-full outline-none"
              value={props.d.name}
              ref={el => queueMicrotask(() => { el.focus(); el.select(); })}
              onPointerDown={e => e.stopPropagation()}
              onKeyDown={e => {
                e.stopPropagation();
                if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                if (e.key === "Escape") {
                  (e.currentTarget as HTMLInputElement).value = props.d.name;
                  (e.currentTarget as HTMLInputElement).blur();
                }
              }}
              onBlur={e => {
                setEditing(false);
                const name = e.currentTarget.value.trim();
                if (name && name !== props.d.name) props.onRename(props.d, name);
              }}
            />
          }
        >
          <span
            class="text-xs font-medium text-neutral-800 truncate"
            title={`${props.d.name} — double-click to rename`}
            onDblClick={e => {
              e.stopPropagation();
              setEditing(true);
            }}
          >
            {props.d.name}
          </span>
        </Show>

        <div class="flex items-center gap-1.5 shrink-0">
          <Show when={openThreads() > 0}>
            <span class="flex items-center gap-0.5 text-[10px] text-orange-600 bg-orange-50 rounded-full px-1.5 py-px">
              <Icon icon="iconoir:message-text" width="10" />
              {openThreads()}
            </span>
          </Show>
          <Show when={props.d.versions.length > 0}>
            <span class="text-[10px] text-neutral-400">v{latest()!.number}</span>
          </Show>
          <span
            class={`text-[10px] rounded-full px-1.5 py-px ${STATUS_META[props.d.status].chip}`}
          >
            {STATUS_META[props.d.status].label}
          </span>
        </div>
      </div>
    </div>
  );
}
