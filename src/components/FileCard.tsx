import { Show } from "solid-js";
import { Icon } from "@iconify-icon/solid";
import { kindOfMime } from "../lib/filetypes";
import { fileUrl, type LibraryFile } from "../lib/types";
import { EntityAvatar } from "./Avatar";

const KIND_ICON: Record<string, string> = {
  image: "iconoir:media-image",
  pdf: "iconoir:page",
  video: "iconoir:media-video",
  audio: "iconoir:music-note",
  font: "iconoir:text",
  archive: "iconoir:archive",
  doc: "iconoir:page",
};

export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/**
 * One library file. Images render a thumbnail; other kinds get a generic
 * card with the type icon and extension. Mirrors of deliverable versions
 * carry a canvas badge — the parent wires clicks and the context menu.
 */
export function FileCard(props: {
  file: LibraryFile;
  /** owning folder's entity — shown as an avatar under "All Entities" scope */
  entityName?: string | null;
  onClick?: (e: MouseEvent) => void;
  onDblClick?: (e: MouseEvent) => void;
  onContextMenu?: (e: MouseEvent) => void;
  /** drag-to-folder support (parent stashes the drag set) */
  draggable?: boolean;
  onDragStart?: (e: DragEvent) => void;
  /** briefly flagged when arriving here from a search result */
  highlighted?: boolean;
  /** multi-select state + toggle (hover-revealed checkbox) */
  selected?: boolean;
  onToggleSelect?: () => void;
  /** grid thumbnail (default) or compact stacked row */
  layout?: "grid" | "list";
}) {
  const kind = () => kindOfMime(props.file.mime);
  const ext = () => {
    const i = props.file.fileName.lastIndexOf(".");
    return i >= 0 ? props.file.fileName.slice(i + 1).toUpperCase() : "";
  };
  const checkbox = (extra: string) => (
    <Show when={props.onToggleSelect}>
      <button
        class={`w-4 h-4 rounded border flex items-center justify-center cursor-pointer bg-panel/90 ${extra}`}
        classList={{
          "border-neutral-300 opacity-0 group-hover:opacity-100": !props.selected,
          "border-sky-500 bg-sky-500 text-white opacity-100": !!props.selected,
        }}
        title="Select"
        onClick={e => {
          e.stopPropagation();
          props.onToggleSelect!();
        }}
      >
        <Show when={props.selected}>
          <Icon icon="iconoir:check" width="10" />
        </Show>
      </button>
    </Show>
  );

  if (props.layout === "list") {
    return (
      <div
        data-file-card
        class="group flex items-center gap-3 px-3 py-2 hover:bg-neutral-50 cursor-pointer select-none"
        classList={{ "bg-accent-sky": props.selected, "ring-2 ring-sky-400": props.highlighted }}
        draggable={props.draggable}
        onDragStart={e => props.onDragStart?.(e)}
        onClick={e => props.onClick?.(e)}
        onDblClick={e => props.onDblClick?.(e)}
        onContextMenu={e => {
          e.preventDefault();
          props.onContextMenu?.(e);
        }}
      >
        {checkbox("shrink-0")}
        <div class="w-10 h-10 shrink-0 rounded bg-surface border border-neutral-100 overflow-hidden flex items-center justify-center">
          <Show
            when={kind() === "image"}
            fallback={<Icon icon={KIND_ICON[kind()] ?? "iconoir:page"} width="18" class="text-neutral-300" />}
          >
            <img
              src={fileUrl(props.file.fileName)}
              alt={props.file.name}
              class="max-w-full max-h-full w-auto h-auto object-contain"
              loading="lazy"
            />
          </Show>
        </div>
        <Show when={props.entityName}>
          <EntityAvatar name={props.entityName!} size={14} />
        </Show>
        <p class="flex-1 text-xs font-medium text-neutral-800 truncate" title={props.file.name}>
          {props.file.name}
        </p>
        <Show when={props.file.versionId}>
          <span class="shrink-0 flex items-center gap-0.5 text-[10px] text-on-accent-sky bg-accent-sky border border-accent-sky-line rounded px-1 py-px">
            <Icon icon="iconoir:frame" width="9" /> canvas
          </span>
        </Show>
        <span class="shrink-0 text-[10px] text-neutral-400 w-16 text-right">{formatSize(props.file.size)}</span>
      </div>
    );
  }

  return (
    <div
      data-file-card
      class="group text-left border rounded-lg bg-panel hover:shadow-sm transition-all cursor-pointer overflow-clip select-none"
      classList={{
        "ring-2 ring-sky-400": props.highlighted,
        "border-sky-500": props.selected,
        "border-neutral-200 hover:border-neutral-300": !props.selected,
      }}
      draggable={props.draggable}
      onDragStart={e => props.onDragStart?.(e)}
      onClick={e => props.onClick?.(e)}
      onDblClick={e => props.onDblClick?.(e)}
      onContextMenu={e => {
        e.preventDefault();
        props.onContextMenu?.(e);
      }}
    >
      <div class="relative h-24 bg-surface flex items-center justify-center overflow-clip p-2">
        {checkbox("absolute top-1.5 left-1.5 z-10")}
        <Show
          when={kind() === "image"}
          fallback={
            <div class="flex flex-col items-center gap-1 text-neutral-300">
              <Icon icon={KIND_ICON[kind()] ?? "iconoir:page"} width="24" />
              <span class="text-[10px] font-medium tracking-wide">{ext()}</span>
            </div>
          }
        >
          <img
            src={fileUrl(props.file.fileName)}
            alt={props.file.name}
            class="max-w-full max-h-full w-auto h-auto object-contain"
            loading="lazy"
          />
        </Show>
      </div>
      <div class="px-3 py-2">
        <div class="flex items-center gap-1.5">
          <Show when={props.entityName}>
            <EntityAvatar name={props.entityName!} size={13} />
          </Show>
          <p class="flex-1 text-xs font-medium text-neutral-800 truncate" title={props.file.name}>
            {props.file.name}
          </p>
          <Show when={props.file.versionId}>
            <span
              class="shrink-0 flex items-center gap-0.5 text-[10px] text-on-accent-sky bg-accent-sky border border-accent-sky-line rounded px-1 py-px"
              title="Deliverable version — managed from the canvas"
            >
              <Icon icon="iconoir:frame" width="9" /> canvas
            </span>
          </Show>
        </div>
        <p class="mt-0.5 text-[10px] text-neutral-400">{formatSize(props.file.size)}</p>
      </div>
    </div>
  );
}
