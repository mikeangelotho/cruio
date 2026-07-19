import { For, Show } from "solid-js";
import { Icon } from "@iconify-icon/solid";
import type { Annotation, Deliverable, Version } from "../lib/types";
import { fileUrl } from "../lib/types";
import type { Rect } from "../lib/canvas/camera";

export function pinColor(a: Annotation) {
  switch (a.status) {
    case "open":
      return "bg-orange-500 border-orange-600";
    case "resolved_approved":
      return "bg-emerald-500 border-emerald-600";
    case "resolved_revision":
      return "bg-neutral-400 border-neutral-500";
  }
}

/**
 * The asset in world space with its annotation pins. Placement of new pins is
 * handled by the canvas container (click vs. drag disambiguation lives there).
 */
export function ReviewPlane(props: {
  d: Deliverable;
  version: Version | undefined;
  rect: Rect;
  zoom: number;
  annotations: Annotation[];
  selectedId: string | null;
  onSelectPin: (id: string) => void;
  /** false for guests: they wait for a version instead of uploading one */
  canUpload: boolean;
  /** ring highlight while comparing versions */
  highlight?: boolean;
}) {
  return (
    <div
      class="absolute"
      style={{
        left: `${props.rect.x}px`,
        top: `${props.rect.y}px`,
        width: `${props.rect.w}px`,
        height: `${props.rect.h}px`,
        outline: props.highlight
          ? `${3 / props.zoom}px solid rgb(56 189 248)`
          : undefined,
        "outline-offset": props.highlight ? `${8 / props.zoom}px` : undefined,
      }}
    >
      <Show
        when={props.version}
        fallback={
          <div
            data-plane="drop"
            class="w-full h-full rounded-sm border-2 border-dashed border-neutral-300 bg-white/60 flex flex-col items-center justify-center gap-3 text-neutral-400"
          >
            <Icon
              icon={props.canUpload ? "iconoir:media-image-plus" : "iconoir:clock"}
              width="48"
            />
            <span class="text-lg">
              {props.canUpload
                ? "Drop an image or press U to upload the first version"
                : "Waiting for the first version"}
            </span>
          </div>
        }
      >
        {v => (
          <img
            data-plane="image"
            src={fileUrl(v().fileName)}
            alt={props.d.name}
            width={props.rect.w}
            height={props.rect.h}
            class="w-full h-full shadow-[0_4px_24px_rgba(0,0,0,0.10)] bg-white select-none cursor-crosshair"
            draggable={false}
          />
        )}
      </Show>

      <For each={props.annotations}>
        {(a, i) => (
          <button
            class={`absolute flex items-center justify-center rounded-full rounded-bl-none border text-white text-[11px] font-semibold shadow-md cursor-pointer transition-transform ${pinColor(a)}`}
            style={{
              left: `${a.x * props.rect.w}px`,
              top: `${a.y * props.rect.h}px`,
              width: "22px",
              height: "22px",
              // pins keep constant screen size and anchor their bottom-left tip
              transform: `scale(${1 / props.zoom}) translate(0, -100%) ${
                props.selectedId === a.id ? "scale(1.25)" : ""
              }`,
              "transform-origin": "0 100%",
              "z-index": props.selectedId === a.id ? 3 : 2,
            }}
            title={a.comments[0]?.body ?? "Thread"}
            onPointerDown={e => e.stopPropagation()}
            onClick={e => {
              e.stopPropagation();
              props.onSelectPin(a.id);
            }}
          >
            {i() + 1}
          </button>
        )}
      </For>
    </div>
  );
}
