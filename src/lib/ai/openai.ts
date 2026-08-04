import type Anthropic from "@anthropic-ai/sdk";
import { MODEL, baseURL } from "./model";
import type { TurnParams, TurnResult } from "./loop";

// OpenAI-compatible transport (AI_PROTOCOL=openai). Talks directly to a server
// exposing POST {AI_BASE_URL}/v1/chat/completions — e.g. llama.cpp's
// llama-server — with no LiteLLM/translation layer.
//
// The agent state stays 100% Anthropic-shaped everywhere else; this module is
// the only place the OpenAI wire shape exists. It translates the request on the
// way out (Anthropic content blocks -> OpenAI messages/tools) and re-assembles
// the streamed response into Anthropic content blocks (text + tool_use) on the
// way back, so loop.ts, persistence, and hydrate.ts are untouched.

type Block = {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
};

type OpenAiMessage =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

/** Anthropic message blocks aren't always arrays (a plain string is legal). */
function blocksOf(content: unknown): Block[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content) ? (content as Block[]) : [];
}

function toolResultContent(raw: unknown): string {
  if (typeof raw === "string") return raw;
  return JSON.stringify(raw ?? null);
}

/** Anthropic-shaped conversation -> OpenAI chat-completions messages. */
function translateMessages(systemText: string, messages: TurnParams["messages"]): OpenAiMessage[] {
  const out: OpenAiMessage[] = [{ role: "system", content: systemText }];

  for (const m of messages) {
    if (m.role !== "user" && m.role !== "assistant") continue; // drop stray system rows
    const blocks = blocksOf(m.content);

    if (m.role === "user") {
      // tool_result blocks become their own `tool` messages (they must follow
      // the assistant turn that made the calls); any text becomes a user turn.
      const toolResults = blocks.filter(b => b.type === "tool_result");
      for (const b of toolResults) {
        out.push({
          role: "tool",
          tool_call_id: b.tool_use_id ?? "",
          content: toolResultContent(b.content),
        });
      }
      const text = blocks
        .filter(b => b.type === "text")
        .map(b => b.text ?? "")
        .join("");
      if (text || toolResults.length === 0) out.push({ role: "user", content: text });
      continue;
    }

    // Assistant turn: text -> content, tool_use -> tool_calls, thinking dropped.
    const text = blocks
      .filter(b => b.type === "text")
      .map(b => b.text ?? "")
      .join("");
    const toolCalls = blocks
      .filter(b => b.type === "tool_use")
      .map(b => ({
        id: b.id ?? "",
        type: "function" as const,
        function: { name: b.name ?? "", arguments: JSON.stringify(b.input ?? {}) },
      }));
    out.push({
      role: "assistant",
      content: text || null,
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    });
  }

  return out;
}

type ToolCallAcc = { id: string; name: string; args: string };

/** Parse one SSE line, mutating the running accumulators. Returns done. */
function consumeChunk(
  json: {
    choices?: { delta?: { content?: string; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  },
  acc: { text: string; tools: ToolCallAcc[]; usage: { input: number; output: number } },
  emit: TurnParams["emit"],
): void {
  const delta = json.choices?.[0]?.delta;
  if (delta?.content) {
    acc.text += delta.content;
    emit({ type: "text", delta: delta.content });
  }
  for (const tc of delta?.tool_calls ?? []) {
    const i = tc.index ?? 0;
    const slot = (acc.tools[i] ??= { id: "", name: "", args: "" });
    if (tc.id) slot.id = tc.id;
    if (tc.function?.name) slot.name = tc.function.name;
    if (tc.function?.arguments) slot.args += tc.function.arguments;
  }
  if (json.usage) {
    acc.usage.input = json.usage.prompt_tokens ?? acc.usage.input;
    acc.usage.output = json.usage.completion_tokens ?? acc.usage.output;
  }
}

export async function runOpenAiTurn(p: TurnParams): Promise<TurnResult> {
  const url = `${baseURL!.replace(/\/$/, "")}/v1/chat/completions`;
  const body = {
    model: MODEL,
    messages: translateMessages(p.systemText, p.messages),
    ...(p.tools.length
      ? {
          tools: p.tools.map(t => ({
            type: "function" as const,
            function: { name: t.name, description: t.description, parameters: t.input_schema },
          })),
        }
      : {}),
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: 4096,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // llama.cpp ignores this unless started with --api-key; harmless otherwise.
      Authorization: `Bearer ${process.env.ANTHROPIC_API_KEY || "local-dev"}`,
    },
    body: JSON.stringify(body),
    signal: p.signal,
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    // Shape the error so loop.ts's describeApiError surfaces status + detail.
    throw Object.assign(new Error(detail || res.statusText || "request failed"), {
      status: res.status,
    });
  }

  const acc = { text: "", tools: [] as ToolCallAcc[], usage: { input: 0, output: 0 } };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  // Server-Sent Events: records are separated by blank lines; each carries one
  // or more `data:` lines. `data: [DONE]` ends the stream.
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        consumeChunk(JSON.parse(data), acc, p.emit);
      } catch {
        // A partial/non-JSON keep-alive line — ignore.
      }
    }
  }

  const content: Anthropic.Beta.BetaContentBlock[] = [];
  if (acc.text) content.push({ type: "text", text: acc.text, citations: null } as never);
  for (const t of acc.tools) {
    let input: unknown = {};
    try {
      input = t.args ? JSON.parse(t.args) : {};
    } catch {
      // Leave input empty; action validation returns a typed error the model
      // can correct on the next turn rather than crashing the loop.
    }
    content.push({ type: "tool_use", id: t.id, name: t.name, input } as never);
  }

  return {
    content,
    refusal: false,
    usage: {
      inputTokens: acc.usage.input,
      outputTokens: acc.usage.output,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
  };
}
