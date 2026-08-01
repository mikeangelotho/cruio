import { createSignal } from "solid-js";
import { isServer } from "solid-js/web";

export type Theme = "light" | "dark";

/** Read the theme the no-flash head script already applied to <html>. */
function initial(): Theme {
  if (isServer) return "light";
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "dark" || attr === "light") return attr;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

const [theme, setThemeSignal] = createSignal<Theme>(initial());
export { theme };

export function setTheme(t: Theme) {
  setThemeSignal(t);
  if (isServer) return;
  document.documentElement.setAttribute("data-theme", t);
  try {
    localStorage.setItem("cruio_theme", t);
  } catch {
    /* private mode — the in-memory signal still drives the UI this session */
  }
}

export function toggleTheme() {
  setTheme(theme() === "dark" ? "light" : "dark");
}
