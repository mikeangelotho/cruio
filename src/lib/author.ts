import { createSignal } from "solid-js";
import { isServer } from "solid-js/web";

const KEY = "cruio.author";

// Node exposes a global localStorage that throws without --localstorage-file,
// so gate on isServer rather than typeof checks.
function readStored(): string {
  if (isServer) return "";
  try {
    return window.localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

const [author, setAuthorSignal] = createSignal<string>(readStored());

export { author };

export function setAuthor(name: string) {
  setAuthorSignal(name);
  if (isServer) return;
  try {
    window.localStorage.setItem(KEY, name);
  } catch {}
}
