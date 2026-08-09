import { Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { Icon } from "@iconify-icon/solid";

/**
 * Controlled text-prompt modal — the styled replacement for window.prompt.
 * Drive it app-wide via createConfirm()/<ConfirmHost>. Enter submits, Esc cancels.
 * Shares StatusConflictModal's scrim/panel shell.
 */
export function PromptModal(props: {
  open: boolean;
  title: string;
  description?: string;
  label?: string;
  placeholder?: string;
  initial?: string;
  confirmLabel?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = createSignal("");
  let inputEl: HTMLInputElement | undefined;

  // Re-seed the field each time the modal opens with a fresh initial value.
  createEffect(() => {
    if (props.open) {
      setValue(props.initial ?? "");
      queueMicrotask(() => {
        inputEl?.focus();
        inputEl?.select();
      });
    }
  });

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (props.open && e.key === "Escape") props.onCancel();
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  const submit = () => props.onConfirm(value().trim());

  return (
    <Show when={props.open}>
      <div
        class="fixed inset-0 z-[70] bg-scrim flex items-center justify-center"
        onClick={props.onCancel}
      >
        <div
          class="w-[400px] max-w-[90vw] bg-panel rounded-xl shadow-2xl border border-neutral-200 overflow-hidden"
          onClick={e => e.stopPropagation()}
        >
          <div class="flex items-start justify-between px-4 pt-4">
            <h2 class="text-base font-semibold text-neutral-800 pr-2">
              {props.title}
            </h2>
            <button
              class="shrink-0 p-1 rounded text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 cursor-pointer"
              title="Cancel"
              onClick={props.onCancel}
            >
              <Icon icon="iconoir:xmark" width="16" />
            </button>
          </div>

          <div class="px-4 pt-3">
            <Show when={props.description}>
              <p class="text-xs leading-snug text-neutral-600 mb-2 whitespace-pre-line">
                {props.description}
              </p>
            </Show>
            <Show when={props.label}>
              <label class="block text-[10px] uppercase tracking-wide text-neutral-400 font-medium mb-1">
                {props.label}
              </label>
            </Show>
            <input
              ref={inputEl}
              class="w-full rounded-md border border-neutral-200 bg-panel px-2.5 py-1.5 text-sm text-neutral-800 outline-none focus:border-neutral-400"
              placeholder={props.placeholder}
              value={value()}
              onInput={e => setValue(e.currentTarget.value)}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
            />
          </div>

          <div class="px-4 py-2.5 mt-3 border-t border-neutral-100 flex justify-end gap-2">
            <button
              class="text-xs px-3 py-1.5 rounded-md text-neutral-600 hover:bg-neutral-100 cursor-pointer"
              onClick={props.onCancel}
            >
              Cancel
            </button>
            <button
              class="text-xs px-3 py-1.5 rounded-md bg-brand text-on-brand hover:bg-brand-hover cursor-pointer font-medium"
              onClick={submit}
            >
              {props.confirmLabel ?? "Save"}
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
