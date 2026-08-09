import { Show, createMemo } from "solid-js";
import { pending, settleConfirm, settlePrompt } from "../lib/confirm";
import { ConfirmModal } from "./ConfirmModal";
import { PromptModal } from "./PromptModal";

/**
 * Single app-wide host for confirm()/promptText() (mirrors ToastHost). Mounted
 * once in the app root; renders the styled ConfirmModal/PromptModal driven by the
 * confirm.ts singleton so any screen can `await confirm({...})` without wiring.
 */
export function ConfirmHost() {
  const confirmState = createMemo(() => {
    const p = pending();
    return p?.kind === "confirm" ? p.opts : null;
  });
  const promptState = createMemo(() => {
    const p = pending();
    return p?.kind === "prompt" ? p.opts : null;
  });

  return (
    <>
      <Show when={confirmState()}>
        {opts => (
          <ConfirmModal
            open={true}
            title={opts().title}
            description={opts().description}
            confirmLabel={opts().confirmLabel}
            cancelLabel={opts().cancelLabel}
            danger={opts().danger}
            onConfirm={() => settleConfirm(true)}
            onCancel={() => settleConfirm(false)}
          />
        )}
      </Show>
      <Show when={promptState()}>
        {opts => (
          <PromptModal
            open={true}
            title={opts().title}
            description={opts().description}
            label={opts().label}
            placeholder={opts().placeholder}
            initial={opts().initial}
            confirmLabel={opts().confirmLabel}
            onConfirm={v => settlePrompt(v)}
            onCancel={() => settlePrompt(null)}
          />
        )}
      </Show>
    </>
  );
}
