import Anthropic from "@anthropic-ai/sdk";

// Server-only. The base-URL seam lets a local model server stand in during
// development without touching call sites.
//
//   ANTHROPIC_API_KEY   real key (unset when pointing at a local server)
//   AI_BASE_URL         e.g. http://localhost:8080 — anything Anthropic-shaped
//   AI_MODEL            override the model id
//   AI_EFFORT           low | medium | high | xhigh | max
//
// If the local server speaks OpenAI's schema rather than Anthropic's, put
// LiteLLM in front of it in Anthropic mode rather than writing an adapter.

const baseURL = process.env.AI_BASE_URL?.trim() || undefined;

/** Betas and server-side features only exist on the real API. */
export const isAnthropic = !baseURL;

export const MODEL = process.env.AI_MODEL?.trim() || "claude-opus-5";
export const EFFORT = (process.env.AI_EFFORT?.trim() || "medium") as
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export const aiConfigured = Boolean(process.env.ANTHROPIC_API_KEY || baseURL);

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || "local-dev",
  baseURL,
});

/**
 * Shared request knobs.
 *
 * Everything beyond model/max_tokens/messages/tools is Anthropic-specific and
 * is only sent when talking to the real API. A local server behind AI_BASE_URL
 * generally implements the bare Messages shape and 400s on `thinking`,
 * `output_config`, or an unknown beta — which looks like a broken integration
 * rather than an unsupported option.
 *
 * - No temperature/top_p/top_k — rejected with a 400 on claude-opus-5.
 * - `display: "summarized"` so the sidebar shows progress rather than a long
 *   silent pause; thinking is on by default on this model either way.
 * - max_tokens caps thinking PLUS response text, not just the answer.
 */
export function baseParams() {
  if (!isAnthropic) {
    return { model: MODEL, max_tokens: 4096 };
  }
  return {
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" as const, display: "summarized" as const },
    output_config: { effort: EFFORT },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default" as const,
  };
}
