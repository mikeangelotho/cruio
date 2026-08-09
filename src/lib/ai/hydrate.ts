import { ACTIONS_BY_NAME } from "../actions";
import type { StoredMessage } from "./conversations";
import type { Block, ToolCall, UiMessage } from "./useChat";
import { NEXT_STEPS_RE } from "./useChat";

// Server-only: reconstructs the UI's UiMessage[] shape from the raw Anthropic
// content-block JSON persisted per turn. This is a one-shot bulk mapping over
// COMPLETE stored blocks — a different problem from useChat.ts's live path,
// which assembles a message incrementally from streamed deltas with no
// complete blocks to map from. Not worth forcing a shared abstraction between
// the two; this is the one place the raw-block shape is understood.
//
// Known, accepted limitation: a ToolCall's `summary` (e.g. "3 project(s)") is
// only ever computed transiently server-side during the live SSE turn
// (Action.summarize()) and is never persisted — aiMessages.content stores raw
// blocks, not derived summaries. Hydrated tool rows show title + status only.

type AnthropicBlock = {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  tool_use_id?: string;
  is_error?: boolean;
};

function blocksOf(m: StoredMessage): AnthropicBlock[] {
  return Array.isArray(m.content) ? (m.content as AnthropicBlock[]) : [];
}

export function hydrateMessages(stored: StoredMessage[]): UiMessage[] {
  const out: UiMessage[] = [];

  for (let i = 0; i < stored.length; i++) {
    const m = stored[i];
    // The page-context hint is excluded from persistence server-side already
    // (routes/api/ai/chat.ts), but skip any stray "system" row defensively.
    if (m.role !== "user" && m.role !== "assistant") continue;

    const blocks = blocksOf(m);

    if (m.role === "user") {
      // A user turn that's entirely tool_result blocks belongs to the
      // PRECEDING assistant turn — it was already folded into that turn's
      // tool rows below, and shouldn't render as its own bubble (matches
      // live behavior, where a tool_result patches an existing row rather
      // than appearing as a new user message).
      if (blocks.length && blocks.every(b => b.type === "tool_result")) continue;

      const text = blocks
        .filter(b => b.type === "text")
        .map(b => b.text ?? "")
        .join("");
      out.push({ role: "user", text, blocks: [] });
      continue;
    }

    // Assistant turn. thinking is hoisted into its own leading disclosure;
    // text and tool_use blocks are kept in their original order so the
    // rehydrated transcript reads exactly as it did live (a tool called after
    // some prose renders below that prose).
    const thinking = blocks
      .filter(b => b.type === "thinking")
      .map(b => b.thinking ?? "")
      .join("");

    const next = stored[i + 1];
    const results = next && next.role === "user" ? blocksOf(next).filter(b => b.type === "tool_result") : [];

    const uiBlocks: Block[] = [];
    for (const b of blocks) {
      if (b.type === "text") {
        uiBlocks.push({ kind: "text", text: b.text ?? "" });
      } else if (b.type === "tool_use") {
        const result = results.find(r => r.tool_use_id === b.id);
        const tool: ToolCall = {
          id: b.id!,
          name: b.name!,
          title: ACTIONS_BY_NAME.get(b.name!)?.title ?? b.name!,
          status: result ? (result.is_error ? "error" : "ok") : "running",
        };
        uiBlocks.push({ kind: "tool", tool });
      }
    }

    // Mirror the live path: strip the trailing "Next: a | b | c" line off the
    // last text block and surface it as suggestion chips instead of raw prose.
    let suggestions: string[] | undefined;
    for (let k = uiBlocks.length - 1; k >= 0; k--) {
      if (uiBlocks[k].kind !== "text") continue;
      const match = (uiBlocks[k].text ?? "").match(NEXT_STEPS_RE);
      if (match) {
        const parsed = match[1].split("|").map(s => s.trim()).filter(Boolean).slice(0, 3);
        if (parsed.length) {
          suggestions = parsed;
          uiBlocks[k].text = (uiBlocks[k].text ?? "").replace(NEXT_STEPS_RE, "");
        }
      }
      break;
    }

    out.push({ role: "assistant", text: "", thinking: thinking || undefined, blocks: uiBlocks, suggestions });
  }

  return out;
}
