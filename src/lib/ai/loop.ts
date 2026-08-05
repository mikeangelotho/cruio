import type Anthropic from "@anthropic-ai/sdk";
import { MODEL, PROTOCOL, anthropic, baseParams, isAnthropic } from "./model";
import { SYSTEM_PROMPT, contextHint, pageContext, type ContextItem } from "./prompt";
import { ACTIONS_BY_NAME, invokeAction, toolDefinitions } from "../actions";
import { runOpenAiTurn } from "./openai";

// Manual agent loop. The messages array IS the state — Phase 3 resumes an
// approval from exactly this shape, which the SDK's toolRunner could not do
// (it is bound to one live request).

export type LoopEvent =
  | { type: "text"; delta: string }
  | { type: "thinking"; delta: string }
  | { type: "tool_start"; id: string; name: string; title: string }
  | { type: "tool_result"; id: string; ok: boolean; summary?: string }
  | { type: "invalidate" }
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
    }
  | { type: "error"; message: string };

type Msg = Anthropic.Beta.BetaMessageParam;

const MAX_ITERATIONS = 12;

// One streamed model turn, protocol-agnostic. The transport translates at the
// network boundary only — its input and output are always Anthropic-shaped, so
// the loop body, persistence, and hydration never learn which wire is in use.
export type TurnUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export type TurnTool = { name: string; description: string; input_schema: unknown };

export type TurnParams = {
  systemText: string;
  tools: TurnTool[];
  messages: Msg[];
  emit: (e: LoopEvent) => void;
  signal?: AbortSignal;
};

export type TurnResult = {
  /** Assistant content blocks (text + tool_use), Anthropic-shaped. */
  content: Anthropic.Beta.BetaContentBlock[];
  usage: TurnUsage;
  refusal: boolean;
};

/**
 * Anthropic SDK errors carry the useful detail on `status` and the parsed
 * body, not always in `message` — and a misconfigured AI_BASE_URL usually
 * surfaces as a connection error with no body at all. Surface enough for the
 * failure to be actionable from the sidebar alone.
 */
function describeApiError(e: unknown): string {
  const err = e as {
    status?: number;
    message?: string;
    error?: { error?: { type?: string; message?: string } };
  };
  const parts: string[] = [];
  if (typeof err?.status === "number") parts.push(`HTTP ${err.status}`);
  const apiType = err?.error?.error?.type;
  if (apiType) parts.push(apiType);
  const detail = err?.error?.error?.message || err?.message || String(e);
  const prefix = parts.length ? `${parts.join(" ")}: ` : "";
  const where = isAnthropic ? "" : ` (via AI_BASE_URL — ${MODEL})`;
  return `${prefix}${detail}${where}`;
}

function toolParams(): TurnTool[] {
  return toolDefinitions().map(d => ({
    name: d.name,
    description: d.description,
    input_schema: d.input_schema,
  }));
}

/**
 * The Anthropic transport: the real API, or an Anthropic-shaped local server
 * behind AI_BASE_URL. Betas, caching, and thinking are gated on `isAnthropic`.
 */
async function anthropicTurn(p: TurnParams): Promise<TurnResult> {
  const stream = anthropic.beta.messages.stream({
    ...baseParams(),
    system: [
      {
        type: "text",
        text: p.systemText,
        // Caches tools + system together (tools render before system).
        ...(isAnthropic ? { cache_control: { type: "ephemeral" as const } } : {}),
      },
    ],
    tools: p.tools,
    messages: p.messages,
  } as never);

  p.signal?.addEventListener("abort", () => stream.abort(), { once: true });

  for await (const event of stream) {
    if (event.type !== "content_block_delta") continue;
    const delta = event.delta as { type: string; text?: string; thinking?: string };
    if (delta.type === "text_delta" && delta.text) {
      p.emit({ type: "text", delta: delta.text });
    } else if (delta.type === "thinking_delta" && delta.thinking) {
      p.emit({ type: "thinking", delta: delta.thinking });
    }
  }

  const final = await stream.finalMessage();
  const usage = final.usage as unknown as Record<string, number | undefined>;
  return {
    content: final.content,
    refusal: final.stop_reason === "refusal",
    usage: {
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
    },
  };
}

export async function runAgentLoop(opts: {
  messages: Msg[];
  pathname: string;
  /** Context chips from the assistant panel; when present they supersede the
   *  route-derived pageContext (they carry the same screen plus user edits). */
  context?: ContextItem[];
  emit: (e: LoopEvent) => void;
  signal?: AbortSignal;
}): Promise<{ messages: Msg[]; stopped: "done" | "aborted" | "error" }> {
  const messages = opts.messages.slice();

  // Page context prefers a mid-conversation system message: it leaves the
  // cached prefix intact, where rewriting the top-level `system` on every
  // navigation would invalidate the cache each turn. That role is model-gated
  // though, so anything behind AI_BASE_URL gets it appended to the system
  // prompt instead — costs a cache miss, which a local server doesn't have.
  const hint = (opts.context && contextHint(opts.context)) || pageContext(opts.pathname);
  if (hint && isAnthropic) {
    messages.push({ role: "system", content: hint } as unknown as Msg);
  }
  const systemText = hint && !isAnthropic ? `${SYSTEM_PROMPT}\n\n${hint}` : SYSTEM_PROMPT;

  let mutated = false;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    if (opts.signal?.aborted) return { messages, stopped: "aborted" };

    let turn: TurnResult;
    try {
      const params: TurnParams = {
        systemText,
        tools: toolParams(),
        messages,
        emit: opts.emit,
        signal: opts.signal,
      };
      turn = PROTOCOL === "openai" ? await runOpenAiTurn(params) : await anthropicTurn(params);
    } catch (e) {
      if (opts.signal?.aborted) return { messages, stopped: "aborted" };
      opts.emit({ type: "error", message: describeApiError(e) });
      return { messages, stopped: "error" };
    }

    opts.emit({
      type: "usage",
      inputTokens: turn.usage.inputTokens,
      outputTokens: turn.usage.outputTokens,
      cacheReadTokens: turn.usage.cacheReadTokens,
      cacheWriteTokens: turn.usage.cacheWriteTokens,
    });

    // Check the stop reason BEFORE reading content — on a refusal, content is
    // empty (pre-output) or a partial that must be discarded.
    if (turn.refusal) {
      opts.emit({
        type: "error",
        message: "The model declined this request. Try rephrasing it.",
      });
      return { messages, stopped: "error" };
    }

    // Append verbatim: thinking and tool_use blocks must be echoed unchanged.
    messages.push({ role: "assistant", content: turn.content });

    const toolUses = turn.content.filter(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
    );
    if (!toolUses.length) {
      if (mutated) opts.emit({ type: "invalidate" });
      return { messages, stopped: "done" };
    }

    // All results for one assistant turn must come back in a SINGLE user
    // message — splitting them trains the model out of parallel tool calls.
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const use of toolUses) {
      const action = ACTIONS_BY_NAME.get(use.name);
      opts.emit({
        type: "tool_start",
        id: use.id,
        name: use.name,
        title: action?.title ?? use.name,
      });

      const outcome = await invokeAction(use.name, use.input);

      if (outcome.ok) {
        if (outcome.mutated) mutated = true;
        opts.emit({
          type: "tool_result",
          id: use.id,
          ok: true,
          summary: outcome.summary,
        });
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: JSON.stringify(outcome.result ?? null),
        });
      } else {
        opts.emit({
          type: "tool_result",
          id: use.id,
          ok: false,
          summary: outcome.error.message,
        });
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          is_error: true,
          content: JSON.stringify(outcome.error),
        });
      }
    }

    messages.push({ role: "user", content: results });
  }

  opts.emit({
    type: "error",
    message: "Stopped after too many steps. Try narrowing the request.",
  });
  return { messages, stopped: "error" };
}
