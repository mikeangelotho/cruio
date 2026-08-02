import { ACTIONS_BY_NAME } from "../actions";
import type { StoredMessage } from "./conversations";
import type { ToolCall, UiMessage } from "./useChat";

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
      out.push({ role: "user", text, tools: [] });
      continue;
    }

    // Assistant turn.
    const text = blocks
      .filter(b => b.type === "text")
      .map(b => b.text ?? "")
      .join("");
    const thinking = blocks
      .filter(b => b.type === "thinking")
      .map(b => b.thinking ?? "")
      .join("");

    const next = stored[i + 1];
    const results = next && next.role === "user" ? blocksOf(next).filter(b => b.type === "tool_result") : [];

    const tools: ToolCall[] = blocks
      .filter(b => b.type === "tool_use")
      .map(b => {
        const result = results.find(r => r.tool_use_id === b.id);
        return {
          id: b.id!,
          name: b.name!,
          title: ACTIONS_BY_NAME.get(b.name!)?.title ?? b.name!,
          status: result ? (result.is_error ? "error" : "ok") : "running",
        };
      });

    out.push({ role: "assistant", text, thinking: thinking || undefined, tools });
  }

  return out;
}
