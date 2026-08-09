import { createSignal } from "solid-js";

export type ConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** destructive styling + intent (delete, remove) */
  danger?: boolean;
};

export type PromptOptions = {
  title: string;
  description?: string;
  /** label above the input */
  label?: string;
  placeholder?: string;
  initial?: string;
  confirmLabel?: string;
};

type ConfirmPending = {
  kind: "confirm";
  opts: ConfirmOptions;
  resolve: (ok: boolean) => void;
};
type PromptPending = {
  kind: "prompt";
  opts: PromptOptions;
  resolve: (value: string | null) => void;
};
export type Pending = ConfirmPending | PromptPending;

// Module-level singleton (mirrors toast.ts): any screen calls confirm()/promptText()
// and the single <ConfirmHost/> mounted in the app root renders the modal. Promise-
// based so callers write `if (await confirm({...})) {…}` — a styled replacement for
// the native window.confirm/prompt. Only one prompt is live at a time.
const [pending, setPending] = createSignal<Pending | null>(null);
export { pending };

function cancelPending() {
  const cur = pending();
  if (!cur) return;
  setPending(null);
  if (cur.kind === "confirm") cur.resolve(false);
  else cur.resolve(null);
}

/** Styled confirmation. Resolves true on confirm, false on cancel/dismiss. */
export function confirm(opts: ConfirmOptions): Promise<boolean> {
  cancelPending();
  return new Promise<boolean>(resolve =>
    setPending({ kind: "confirm", opts, resolve }),
  );
}

/** Styled text prompt. Resolves the entered string, or null on cancel/dismiss. */
export function promptText(opts: PromptOptions): Promise<string | null> {
  cancelPending();
  return new Promise<string | null>(resolve =>
    setPending({ kind: "prompt", opts, resolve }),
  );
}

export function settleConfirm(ok: boolean) {
  const p = pending();
  if (p?.kind !== "confirm") return;
  setPending(null);
  p.resolve(ok);
}

export function settlePrompt(value: string | null) {
  const p = pending();
  if (p?.kind !== "prompt") return;
  setPending(null);
  p.resolve(value);
}
