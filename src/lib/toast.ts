import { createSignal } from "solid-js";

export type Toast = {
  id: string;
  message: string;
  /** optional action button, e.g. { label: "Undo", run } */
  actionLabel?: string;
  onAction?: () => void;
};

// Module-level singleton so any screen can raise a toast and the single
// <ToastHost/> (mounted once in the app root) renders them — survives route
// navigation, unlike per-screen component state.
const [toasts, setToasts] = createSignal<Toast[]>([]);
export { toasts };

const timers = new Map<string, ReturnType<typeof setTimeout>>();

export function dismissToast(id: string) {
  const t = timers.get(id);
  if (t) {
    clearTimeout(t);
    timers.delete(id);
  }
  setToasts(list => list.filter(x => x.id !== id));
}

/** Raise a toast. Returns its id. Auto-dismisses after `timeout` ms (default 6s). */
export function pushToast(
  message: string,
  opts: { actionLabel?: string; onAction?: () => void; timeout?: number } = {},
): string {
  const id = crypto.randomUUID();
  const toast: Toast = {
    id,
    message,
    actionLabel: opts.actionLabel,
    onAction: opts.onAction,
  };
  // cap the visible stack at 4 (drop the oldest)
  setToasts(list => [...list.slice(-3), toast]);
  const timeout = opts.timeout ?? 6000;
  timers.set(
    id,
    setTimeout(() => dismissToast(id), timeout),
  );
  return id;
}
