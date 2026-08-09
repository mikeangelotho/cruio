import { For, Show, createMemo } from "solid-js";
import { Icon } from "@iconify-icon/solid";
import { SidePanel } from "./SidePanel";
import type { Deliverable, DeliverableMetadata } from "../lib/types";

/**
 * Right-sidebar panel for a deliverable's custom metadata — reference links
 * (label + URL) and free-form key/value fields. Edits are committed through
 * `onSave`, which the canvas wires to store.setDeliverableMetadata (optimistic).
 * Shares the canvas right-panel wrapper class with the tasks/library panels.
 */
export function MetadataPanel(props: {
  deliverable: Deliverable | undefined;
  readOnly?: boolean;
  onSave: (id: string, metadata: DeliverableMetadata) => void;
  onClose: () => void;
}) {
  const meta = createMemo<DeliverableMetadata>(
    () => props.deliverable?.metadata ?? { links: [], fields: [] },
  );

  function commit(next: DeliverableMetadata) {
    const d = props.deliverable;
    if (!d) return;
    props.onSave(d.id, next);
  }

  const addLink = () =>
    commit({ ...meta(), links: [...meta().links, { label: "", url: "" }] });
  const setLink = (i: number, patch: Partial<{ label: string; url: string }>) =>
    commit({
      ...meta(),
      links: meta().links.map((l, j) => (j === i ? { ...l, ...patch } : l)),
    });
  const removeLink = (i: number) =>
    commit({ ...meta(), links: meta().links.filter((_, j) => j !== i) });

  const addField = () =>
    commit({ ...meta(), fields: [...meta().fields, { key: "", value: "" }] });
  const setField = (i: number, patch: Partial<{ key: string; value: string }>) =>
    commit({
      ...meta(),
      fields: meta().fields.map((f, j) => (j === i ? { ...f, ...patch } : f)),
    });
  const removeField = (i: number) =>
    commit({ ...meta(), fields: meta().fields.filter((_, j) => j !== i) });

  const inputClass =
    "flex-1 min-w-0 text-xs bg-panel border border-neutral-200 rounded px-1.5 py-1 outline-none focus:border-neutral-400 placeholder:text-neutral-400";

  return (
    <SidePanel>
      <div class="h-10 px-3 flex items-center justify-between border-b border-neutral-100">
        <span class="text-xs font-semibold text-neutral-700 truncate">
          Metadata
          <Show when={props.deliverable}>
            <span class="ml-1.5 text-[10px] font-normal text-neutral-400 truncate">
              {props.deliverable!.name}
            </span>
          </Show>
        </span>
        <button
          class="text-[10px] text-neutral-400 hover:text-neutral-700 cursor-pointer"
          onClick={props.onClose}
        >
          Close
        </button>
      </div>

      <Show
        when={props.deliverable}
        fallback={
          <p class="p-3 text-xs text-neutral-400">
            Select a deliverable to view its metadata.
          </p>
        }
      >
        <div class="flex-1 overflow-y-auto p-3 flex flex-col gap-5">
          {/* Reference links */}
          <section>
            <div class="flex items-center justify-between mb-1.5">
              <span class="text-[10px] uppercase tracking-wide text-neutral-400 font-medium">
                Reference links
              </span>
              <Show when={!props.readOnly}>
                <button
                  class="text-[10px] text-sky-700 hover:text-sky-900 flex items-center gap-0.5 cursor-pointer"
                  onClick={addLink}
                >
                  <Icon icon="iconoir:plus" width="11" /> Add
                </button>
              </Show>
            </div>
            <Show
              when={meta().links.length > 0}
              fallback={<p class="text-[11px] text-neutral-400">No links yet.</p>}
            >
              <div class="flex flex-col gap-2">
                <For each={meta().links}>
                  {(link, i) => (
                    <div class="flex flex-col gap-1 rounded-md border border-neutral-150 p-1.5">
                      <div class="flex items-center gap-1.5">
                        <input
                          class={inputClass}
                          placeholder="Label"
                          value={link.label}
                          readOnly={props.readOnly}
                          onChange={(e) => setLink(i(), { label: e.currentTarget.value })}
                        />
                        <Show when={!props.readOnly}>
                          <button
                            class="shrink-0 p-1 rounded text-neutral-400 hover:text-rose-600 hover:bg-accent-rose cursor-pointer"
                            title="Remove link"
                            onClick={() => removeLink(i())}
                          >
                            <Icon icon="iconoir:trash" width="12" />
                          </button>
                        </Show>
                      </div>
                      <div class="flex items-center gap-1.5">
                        <input
                          class={inputClass}
                          placeholder="https://…"
                          value={link.url}
                          readOnly={props.readOnly}
                          onChange={(e) => setLink(i(), { url: e.currentTarget.value })}
                        />
                        <Show when={link.url}>
                          <a
                            class="shrink-0 p-1 rounded text-neutral-400 hover:text-sky-700 hover:bg-accent-sky cursor-pointer"
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Open link"
                          >
                            <Icon icon="iconoir:open-in-window" width="12" />
                          </a>
                        </Show>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </section>

          {/* Custom fields */}
          <section>
            <div class="flex items-center justify-between mb-1.5">
              <span class="text-[10px] uppercase tracking-wide text-neutral-400 font-medium">
                Custom fields
              </span>
              <Show when={!props.readOnly}>
                <button
                  class="text-[10px] text-sky-700 hover:text-sky-900 flex items-center gap-0.5 cursor-pointer"
                  onClick={addField}
                >
                  <Icon icon="iconoir:plus" width="11" /> Add
                </button>
              </Show>
            </div>
            <Show
              when={meta().fields.length > 0}
              fallback={<p class="text-[11px] text-neutral-400">No fields yet.</p>}
            >
              <div class="flex flex-col gap-2">
                <For each={meta().fields}>
                  {(field, i) => (
                    <div class="flex items-center gap-1.5">
                      <input
                        class={`${inputClass} max-w-[38%]`}
                        placeholder="Key"
                        value={field.key}
                        readOnly={props.readOnly}
                        onChange={(e) => setField(i(), { key: e.currentTarget.value })}
                      />
                      <input
                        class={inputClass}
                        placeholder="Value"
                        value={field.value}
                        readOnly={props.readOnly}
                        onChange={(e) => setField(i(), { value: e.currentTarget.value })}
                      />
                      <Show when={!props.readOnly}>
                        <button
                          class="shrink-0 p-1 rounded text-neutral-400 hover:text-rose-600 hover:bg-accent-rose cursor-pointer"
                          title="Remove field"
                          onClick={() => removeField(i())}
                        >
                          <Icon icon="iconoir:trash" width="12" />
                        </button>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </section>
        </div>
      </Show>
    </SidePanel>
  );
}
