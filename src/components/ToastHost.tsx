import { For, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { Icon } from "@iconify-icon/solid";
import { toasts, dismissToast } from "../lib/toast";

/**
 * Single app-wide toast stack (bottom-center), mounted once in the app root so
 * it survives route navigation. Toasts carry an optional action button — used
 * by undo/redo to offer "Undo" inline (keyboard shortcuts drive the same stack).
 */
export function ToastHost() {
  return (
    <Portal>
      <div class="fixed bottom-16 left-1/2 -translate-x-1/2 z-[60] flex flex-col items-center gap-2 pointer-events-none">
        <For each={toasts()}>
          {t => (
            <div class="pointer-events-auto flex items-center gap-3 bg-brand text-on-brand rounded-lg shadow-2xl px-3 py-2 text-xs max-w-[90vw]">
              <span class="truncate">{t.message}</span>
              <Show when={t.actionLabel}>
                <button
                  class="shrink-0 font-medium underline underline-offset-2 hover:opacity-80 cursor-pointer"
                  onClick={() => {
                    t.onAction?.();
                    dismissToast(t.id);
                  }}
                >
                  {t.actionLabel}
                </button>
              </Show>
              <button
                class="shrink-0 rounded p-0.5 hover:bg-panel/10 cursor-pointer"
                title="Dismiss"
                onClick={() => dismissToast(t.id)}
              >
                <Icon icon="iconoir:xmark" width="13" />
              </button>
            </div>
          )}
        </For>
      </div>
    </Portal>
  );
}
