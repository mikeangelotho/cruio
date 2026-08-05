import { createSignal } from "solid-js";
import type { ConflictTask } from "../components/StatusConflictModal";

export type ConfirmOptions = {
  title: string;
  description: string;
  tasks: ConflictTask[];
  confirmLabel: string;
};

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

/**
 * Promise-based driver for StatusConflictModal — an ergonomic replacement for
 * window.confirm that shows the offending tasks. A page holds one instance,
 * renders `<StatusConflictModal>` bound to `state`, and callers write
 * `if (await confirm({...})) {…}`. Only one prompt is live at a time.
 */
export function createStatusConfirm() {
  const [state, setState] = createSignal<Pending | null>(null);

  function confirm(opts: ConfirmOptions): Promise<boolean> {
    // If one is already open, resolve it false before replacing.
    state()?.resolve(false);
    return new Promise<boolean>(resolve => setState({ ...opts, resolve }));
  }

  function settle(ok: boolean) {
    const s = state();
    setState(null);
    s?.resolve(ok);
  }

  return { state, confirm, settle };
}
