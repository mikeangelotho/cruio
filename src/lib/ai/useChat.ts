import { revalidate } from "@solidjs/router";
import { createSignal } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { loadConversation } from "./conversations";
import type { ContextItem } from "./prompt";

// Client-side chat state. Talks to POST /api/ai/chat, which streams SSE.
// The server owns the real conversation (raw Anthropic content blocks); this
// keeps only what the UI needs to render.

export type ToolCall = {
  id: string;
  name: string;
  title: string;
  status: "running" | "ok" | "error";
  summary?: string;
};

/**
 * One ordered piece of an assistant turn: a run of prose (`kind: "text"`) or a
 * tool call (`kind: "tool"`), in the exact order the model produced them.
 * Interleaving text and tools — rather than hoisting every tool row above the
 * prose — keeps the transcript chronological: a tool the model calls *after*
 * writing some text renders below that text. Fields are optional (rather than a
 * discriminated union) so the streaming store patches stay simple to type;
 * always read `kind` to know which field is set.
 */
export type Block = {
  kind: "text" | "tool";
  /** set when kind === "text" */
  text?: string;
  /** set when kind === "tool" */
  tool?: ToolCall;
};

export type UiMessage = {
  role: "user" | "assistant";
  /** User turns: the message text. Assistant prose lives in `blocks` instead. */
  text: string;
  thinking?: string;
  /** Assistant turns: ordered text + tool blocks in stream order. Empty for
   *  user turns. */
  blocks: Block[];
  /** Parsed off a trailing "Next: a | b | c" line once the turn is done. */
  suggestions?: string[];
};

/** Matches a trailing "Next: a | b | c" line — see prompt.ts's instruction.
 *  Anchored to the END of the text so it only strips the model's own
 *  suggestion line, never an incidental "Next:" earlier in a reply. */
export const NEXT_STEPS_RE = /\n?Next: (.+)$/;

export type Chat = ReturnType<typeof useChat>;

export function useChat(pathname: () => string, context?: () => ContextItem[]) {
  // A store, not a signal: every streamed delta patches a specific path
  // (message[idx].blocks[k].text, message[idx].blocks[byId].tool.status, ...)
  // rather than
  // replacing the message object wholesale. Replacing the object was the bug
  // — <For> keys by reference, so a new object every token tore down and
  // rebuilt the whole row (losing the Thinking disclosure's open state and
  // producing a visible flicker) instead of a fine-grained text update. See
  // MessageList.tsx's <Index> usage, which depends on this reference staying
  // stable.
  const [messagesStore, setMessages] = createStore<UiMessage[]>([]);
  const [input, setInput] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [conversationId, setConversationId] = createSignal<string | null>(null);

  let abort: AbortController | undefined;

  function reset() {
    abort?.abort();
    abort = undefined;
    setMessages([]);
    setConversationId(null);
    setError(null);
    setBusy(false);
  }

  function stop() {
    abort?.abort();
    abort = undefined;
    setBusy(false);
  }

  /** Load a past conversation from history. Aborts any in-flight stream
   *  first — otherwise a stray delta from the old turn could patch the
   *  newly-loaded array by a now-stale index. */
  async function load(id: string) {
    abort?.abort();
    abort = undefined;
    setBusy(false);
    setError(null);
    setConversationId(id);
    try {
      const loaded = await loadConversation(id);
      setMessages(loaded);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function send() {
    const text = input().trim();
    if (!text || busy()) return;

    setInput("");
    setError(null);
    setBusy(true);
    // Two length-indexed appends — store setters are synchronous, so the
    // second call already sees the first append's new length.
    setMessages(messagesStore.length, { role: "user", text, blocks: [] });
    setMessages(messagesStore.length, { role: "assistant", text: "", blocks: [] });

    abort = new AbortController();
    let dirty = false;

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          conversationId: conversationId(),
          pathname: pathname(),
          context: context?.() ?? [],
        }),
        signal: abort.signal,
      });

      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => "");
        throw new Error(detail.slice(0, 400) || `Request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        // SSE frames are separated by a blank line.
        let sep: number;
        while ((sep = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, sep);
          buf = buf.slice(sep + 2);

          let event = "message";
          const dataLines: string[] = [];
          for (const line of frame.split("\n")) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
            // ":" comment lines (keepalives) are ignored
          }
          if (!dataLines.length) continue;

          let payload: Record<string, unknown>;
          try {
            payload = JSON.parse(dataLines.join("\n"));
          } catch {
            continue;
          }

          const lastIdx = messagesStore.length - 1;

          switch (event) {
            case "conversation":
              setConversationId(payload.id as string);
              break;
            case "text": {
              // Append to the trailing text block, or open a new one if the
              // last block is a tool call — this is what keeps prose and tool
              // rows interleaved in the order the model produced them.
              const blocks = messagesStore[lastIdx].blocks;
              const tail = blocks[blocks.length - 1];
              if (tail && tail.kind === "text") {
                setMessages(lastIdx, "blocks", blocks.length - 1, "text", t => (t ?? "") + (payload.delta as string));
              } else {
                setMessages(lastIdx, "blocks", blocks.length, { kind: "text", text: payload.delta as string });
              }
              break;
            }
            case "thinking":
              setMessages(lastIdx, "thinking", t => (t ?? "") + (payload.delta as string));
              break;
            case "tool_start": {
              const blocks = messagesStore[lastIdx].blocks;
              setMessages(lastIdx, "blocks", blocks.length, {
                kind: "tool",
                tool: {
                  id: payload.id as string,
                  name: payload.name as string,
                  title: (payload.title as string) ?? (payload.name as string),
                  status: "running",
                },
              });
              break;
            }
            case "tool_result":
              // Patch the matching tool block in place (by tool id) so a result
              // never reorders or duplicates a row.
              setMessages(
                lastIdx,
                "blocks",
                b => b.kind === "tool" && b.tool?.id === payload.id,
                "tool",
                {
                  status: payload.ok ? "ok" : "error",
                  summary: payload.summary as string | undefined,
                } as Partial<ToolCall>,
              );
              break;
            case "invalidate":
              dirty = true;
              break;
            case "error":
              setError((payload.message as string) || "Something went wrong.");
              break;
            case "done": {
              // Parsed once here, not per-delta: a partial "Next:" prefix
              // mid-stream shouldn't be treated as the suggestions line, and
              // stripping it live would flicker as the model writes it. The
              // line is always in the turn's LAST text block.
              const blocks = messagesStore[lastIdx]?.blocks ?? [];
              let ti = -1;
              for (let k = blocks.length - 1; k >= 0; k--) {
                if (blocks[k].kind === "text") { ti = k; break; }
              }
              const finalText = ti >= 0 ? blocks[ti].text ?? "" : "";
              const match = finalText.match(NEXT_STEPS_RE);
              if (match) {
                const suggestions = match[1]
                  .split("|")
                  .map(s => s.trim())
                  .filter(Boolean)
                  .slice(0, 3);
                if (suggestions.length) {
                  setMessages(lastIdx, "blocks", ti, "text", t => (t ?? "").replace(NEXT_STEPS_RE, ""));
                  setMessages(lastIdx, "suggestions", suggestions);
                }
              }
              break;
            }
          }
        }
      }
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(false);
      abort = undefined;
      // Drop a trailing empty assistant turn (aborted before any output) —
      // a genuine discard, not a per-delta patch, so a full replace is fine.
      setMessages(
        produce(arr => {
          const last = arr[arr.length - 1];
          if (last && last.role === "assistant" && !last.blocks.length && !last.thinking) {
            arr.pop();
          }
        }),
      );
      if (dirty) {
        // Router queries (session, orgs) refetch; createResource-backed pages
        // listen for the event and call their own refetch.
        void revalidate(undefined);
        window.dispatchEvent(new CustomEvent("cruio:invalidate"));
      }
    }
  }

  return {
    messages: () => messagesStore,
    input,
    setInput,
    busy,
    error,
    send,
    stop,
    reset,
    load,
    conversationId,
  };
}
