import { createSignal } from "solid-js";

/**
 * A single reversible action. `undo` reverts it; `redo` re-applies it. Both run
 * against the same optimistic local state + server calls the original action
 * used, so they're symmetric.
 */
export type Command = {
  /** short human label, e.g. "Move deliverable" — shown in the undo toast */
  label: string;
  undo: () => void;
  redo: () => void;
};

/**
 * A bounded per-screen undo/redo stack. `push` records a just-performed action
 * (and clears the redo branch). `undo`/`redo` run the command and return it so
 * the caller can surface a toast. Stacks are created per screen and reset on
 * navigation (the component unmounts), which is the intended scope.
 */
export function createUndoStack(limit = 50) {
  const [past, setPast] = createSignal<Command[]>([]);
  const [future, setFuture] = createSignal<Command[]>([]);

  return {
    canUndo: () => past().length > 0,
    canRedo: () => future().length > 0,
    push(cmd: Command) {
      setPast(p => [...p.slice(Math.max(0, p.length - (limit - 1))), cmd]);
      setFuture([]);
    },
    undo(): Command | null {
      const p = past();
      const cmd = p[p.length - 1];
      if (!cmd) return null;
      cmd.undo();
      setPast(p.slice(0, -1));
      setFuture(f => [...f, cmd]);
      return cmd;
    },
    redo(): Command | null {
      const f = future();
      const cmd = f[f.length - 1];
      if (!cmd) return null;
      cmd.redo();
      setFuture(f.slice(0, -1));
      setPast(p => [...p, cmd]);
      return cmd;
    },
    clear() {
      setPast([]);
      setFuture([]);
    },
  };
}

export type UndoStack = ReturnType<typeof createUndoStack>;
