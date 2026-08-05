import { For, Show } from "solid-js";
import { Icon } from "@iconify-icon/solid";
import { NavMenu } from "./NavMenu";
import type { TaskStatus } from "../lib/types";
import { TASK_STATUS_META, TASK_STATUS_ORDER } from "../lib/task-status";

/**
 * The single status control used everywhere a task or project status is set —
 * task rows, the task detail panel, the canvas task panel, and project cards.
 * A dot + label trigger opens a dropdown of the three states (checkmark on the
 * current one), so there is exactly one interaction model instead of the old
 * mix of a binary checkbox, a cycling dot, and ad-hoc pickers. Any conflict
 * (e.g. advancing a project past unfinished tasks) is handled by the caller's
 * onSelect — the control always offers every state.
 */
export function StatusControl(props: {
  status: TaskStatus;
  onSelect: (status: TaskStatus) => void;
  /** Read-only rendering (no dropdown) — e.g. non-admins on a project pill. */
  disabled?: boolean;
  /** "pill": compact dot + label (dense rows). "chip": colored accent chip
   *  with a caret (project cards, panel headers). Default "pill". */
  variant?: "pill" | "chip";
  /** Stop click/pointer propagation so an enclosing clickable row (which opens
   *  a panel) doesn't also fire. */
  stopPropagation?: boolean;
  portal?: boolean;
  align?: "left" | "right";
  anchor?: "top" | "bottom";
}) {
  const meta = () => TASK_STATUS_META[props.status];
  const variant = () => props.variant ?? "pill";

  const guard = (e: Event) => {
    if (props.stopPropagation) e.stopPropagation();
  };

  const triggerButton = (toggle?: () => void) => {
    const onClick = (e: MouseEvent) => {
      guard(e);
      if (!props.disabled) toggle?.();
    };
    if (variant() === "chip") {
      return (
        <button
          type="button"
          title={`Status: ${meta().label}`}
          disabled={props.disabled}
          class={`inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded ${meta().chip} enabled:cursor-pointer`}
          onClick={onClick}
        >
          <span class={`size-1.5 rounded-full ${meta().dot}`} />
          {meta().label}
          <Show when={!props.disabled}>
            <Icon icon="iconoir:nav-arrow-down" width="11" class="opacity-60" />
          </Show>
        </button>
      );
    }
    return (
      <button
        type="button"
        title={`Status: ${meta().label}`}
        disabled={props.disabled}
        class="shrink-0 flex items-center gap-1 rounded px-1.5 py-0.5 enabled:hover:bg-neutral-100 enabled:cursor-pointer"
        onClick={onClick}
      >
        <span class={`size-1.5 rounded-full ${meta().dot}`} />
        <span class={`text-[10px] font-medium ${meta().text}`}>{meta().label}</span>
      </button>
    );
  };

  return (
    <Show when={!props.disabled} fallback={triggerButton()}>
      <NavMenu
        portal={props.portal}
        align={props.align}
        anchor={props.anchor}
        panelClass="w-40"
        trigger={({ toggle }) => triggerButton(toggle)}
      >
        {({ close }) => (
          <div class="p-1" onClick={guard}>
            <For each={TASK_STATUS_ORDER}>
              {opt => {
                const m = TASK_STATUS_META[opt];
                return (
                  <button
                    type="button"
                    class="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs text-neutral-700 hover:bg-neutral-50 cursor-pointer"
                    onClick={() => {
                      close();
                      props.onSelect(opt);
                    }}
                  >
                    <span class={`size-1.5 rounded-full ${m.dot}`} />
                    <span class="flex-1">{m.label}</span>
                    <Show when={props.status === opt}>
                      <Icon icon="iconoir:check" width="12" class="text-neutral-400" />
                    </Show>
                  </button>
                );
              }}
            </For>
          </div>
        )}
      </NavMenu>
    </Show>
  );
}
