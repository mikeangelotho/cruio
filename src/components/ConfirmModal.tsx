import { Show, onCleanup, onMount } from "solid-js";
import { Icon } from "@iconify-icon/solid";

/**
 * Controlled confirmation modal — the styled replacement for window.confirm.
 * Drive it app-wide via createConfirm()/<ConfirmHost>, or standalone. Copies
 * StatusConflictModal's scrim/panel shell. `danger` gives a destructive button.
 */
export function ConfirmModal(props: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!props.open) return;
      if (e.key === "Escape") props.onCancel();
      else if (e.key === "Enter") props.onConfirm();
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

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

          <Show when={props.description}>
            <div class="px-4 pt-2 text-xs leading-snug text-neutral-600 whitespace-pre-line">
              {props.description}
            </div>
          </Show>

          <div class="px-4 py-2.5 mt-3 border-t border-neutral-100 flex justify-end gap-2">
            <button
              class="text-xs px-3 py-1.5 rounded-md text-neutral-600 hover:bg-neutral-100 cursor-pointer"
              onClick={props.onCancel}
            >
              {props.cancelLabel ?? "Cancel"}
            </button>
            <button
              classList={{
                "text-xs px-3 py-1.5 rounded-md cursor-pointer font-medium": true,
                "bg-brand text-on-brand hover:bg-brand-hover": !props.danger,
                "bg-accent-rose text-on-accent-rose border border-accent-rose-line hover:bg-accent-rose-hover":
                  !!props.danger,
              }}
              onClick={props.onConfirm}
            >
              {props.confirmLabel ?? (props.danger ? "Delete" : "Confirm")}
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
