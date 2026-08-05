import { createSignal } from "solid-js";

// Module-singleton open state, same pattern as lib/theme.ts. The panel is
// rendered once at the Router root (AiPanel) so its chat state survives
// navigation, but the trigger button lives inside AppFooter, which remounts
// on every route — so the two need a shared signal rather than local state.

const [aiPanelOpen, setAiPanelOpen] = createSignal(false);
export { aiPanelOpen };

export function toggleAiPanel() {
  setAiPanelOpen(o => !o);
}

// Minimizing collapses the panel back into the launcher (AiTrigger) without
// tearing down the conversation: the chat store lives in the always-mounted
// AiPanel, so only its DOM subtree hides. Reopening restores the same chat.
export function minimizeAiPanel() {
  setAiPanelOpen(false);
}
