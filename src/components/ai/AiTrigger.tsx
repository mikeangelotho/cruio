import { Icon } from "@iconify-icon/solid";
import { aiPanelOpen, toggleAiPanel } from "../../lib/ai/panelState";

/**
 * The "Ask AI" button — icon + short label, using the same neutral hover
 * language as the surrounding nav controls (`text-neutral-500
 * hover:text-neutral-800 hover:bg-neutral-200/50`). Lives in the top nav: on
 * the main views to the right of the search bar, on the canvas to the right of
 * the action-menu buttons. Carries a label (unlike its icon-only siblings)
 * since it's a primary entry point rather than a secondary utility action.
 */
export function AiTrigger() {
  return (
    <button
      type="button"
      onClick={toggleAiPanel}
      title="Ask AI  (Ctrl+I)"
      aria-label={aiPanelOpen() ? "Close assistant" : "Ask AI"}
      aria-expanded={aiPanelOpen()}
      class="flex items-center gap-1.5 shrink-0 rounded px-1.5 py-1 cursor-pointer transition-colors"
      classList={{
        "text-neutral-700 bg-neutral-200/60": aiPanelOpen(),
        "text-neutral-500 hover:text-neutral-800 hover:bg-neutral-200/50": !aiPanelOpen(),
      }}
    >
      <Icon icon="iconoir:sparks" width="13" />
      <span class="text-[11px]">Ask AI</span>
    </button>
  );
}
