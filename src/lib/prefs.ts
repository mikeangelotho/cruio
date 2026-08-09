/**
 * Tiny per-browser preference store over localStorage — used for view/sort
 * preferences that should survive a reload (Projects & Tasks screens).
 *
 * SSR-safe: Node 25's global `localStorage` shim throws on access during SSR
 * (see ProjectCanvas snap-pref handling), so every call is guarded by a
 * `window` check and wrapped in try/catch. Reads fall back to the supplied
 * default, so a fresh browser or a disabled store just behaves like today.
 */

function canUse(): boolean {
  return typeof window !== "undefined" && !!window.localStorage;
}

/** Read a string preference, or `fallback` when unset/unavailable. */
export function getPref(key: string, fallback = ""): string {
  if (!canUse()) return fallback;
  try {
    const v = window.localStorage.getItem(key);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

/** Read a boolean preference (stored as "1"/"0"). */
export function getBoolPref(key: string, fallback = false): boolean {
  const v = getPref(key, fallback ? "1" : "0");
  return v === "1";
}

/** Persist a string preference (no-op when unavailable). */
export function setPref(key: string, value: string): void {
  if (!canUse()) return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* quota / disabled — preferences are best-effort */
  }
}

/** Persist a boolean preference. */
export function setBoolPref(key: string, value: boolean): void {
  setPref(key, value ? "1" : "0");
}
