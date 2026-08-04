import { A } from "@solidjs/router";
import { Icon } from "@iconify-icon/solid";
import { For, Index, Show, createEffect, createSignal, onCleanup } from "solid-js";
import type { Chat, ToolCall, UiMessage } from "../../lib/ai/useChat";

const DOT = {
  running: "bg-neutral-400 animate-pulse",
  ok: "bg-emerald-500",
  error: "bg-rose-500",
} as const;

/**
 * One quiet line per tool call. Deliberately not a tinted chip — a turn can
 * fire several of these and coloured blocks turn the transcript into noise.
 */
function ToolRow(props: { tool: ToolCall }) {
  return (
    <div class="flex items-baseline gap-2 text-[11px] text-neutral-500 leading-relaxed">
      <span
        class={`mt-1.5 w-1.5 h-1.5 shrink-0 rounded-full ${DOT[props.tool.status]}`}
      />
      <span class="truncate">
        {props.tool.title}
        <Show when={props.tool.summary}>
          <span class="text-neutral-400"> · {props.tool.summary}</span>
        </Show>
      </span>
    </div>
  );
}

function Thinking(props: { text: string }) {
  const [open, setOpen] = createSignal(false);
  return (
    <div class="text-[11px]">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        class="flex items-center gap-1 text-neutral-400 hover:text-neutral-600 transition-colors"
      >
        <Icon
          icon={open() ? "iconoir:nav-arrow-down" : "iconoir:nav-arrow-right"}
          width="11"
        />
        Thinking
      </button>
      <Show when={open()}>
        <p class="mt-1 pl-3.5 whitespace-pre-wrap italic text-neutral-400 leading-relaxed">
          {props.text}
        </p>
      </Show>
    </div>
  );
}

// Matches the model's [[project:<id>|Label]] / [[task:<id>|Label]] citation
// syntax (see prompt.ts). Route mapping mirrors what each page already reads
// for its own deep-link/highlight handling — project has no query param,
// task reads ?task=<id> (tasks.tsx).
const CITATION_RE = /\[\[(project|task):([0-9a-f-]+)\|([^\]]+)\]\]/g;

function citationHref(type: string, id: string): string {
  return type === "task" ? `/tasks?task=${id}` : `/p/${id}`;
}

/** Splits assistant text on citation tokens, rendering the rest as plain
 *  text and each citation as a small inline link. Not a full markdown
 *  renderer — just this one documented micro-syntax. */
function CitedText(props: { text: string }) {
  const parts = () => {
    const out: (string | { type: string; id: string; label: string })[] = [];
    let last = 0;
    for (const m of props.text.matchAll(CITATION_RE)) {
      if (m.index! > last) out.push(props.text.slice(last, m.index));
      out.push({ type: m[1], id: m[2], label: m[3] });
      last = m.index! + m[0].length;
    }
    if (last < props.text.length) out.push(props.text.slice(last));
    return out;
  };
  return (
    <For each={parts()}>
      {p =>
        typeof p === "string" ? (
          <>{p}</>
        ) : (
          <A href={citationHref(p.type, p.id)} class="text-sky-700 hover:text-sky-900 underline underline-offset-2">
            {p.label}
          </A>
        )
      }
    </For>
  );
}

/**
 * A row of clickable suggestion chips. Shared by the empty-state prompts and
 * the post-turn "Next:" suggestions — but alignment is a prop, not baked in:
 * the empty state sits flush against the panel edge (needs a small negative
 * margin to optically align), while post-turn chips sit inside a message's
 * own padding and would be pushed off if the same margin were hard-coded.
 */
function SuggestionChips(props: {
  items: string[];
  align?: "flush" | "inline";
  onPick: (text: string) => void;
}) {
  return (
    <div class={`flex flex-col items-start gap-0.5 ${props.align === "flush" ? "-ml-1.5" : ""}`}>
      <For each={props.items}>
        {s => (
          <button
            type="button"
            onClick={() => props.onPick(s)}
            class="rounded-md px-1.5 py-1 text-xs text-left text-neutral-500 hover:text-neutral-900 hover:bg-muted transition-colors"
          >
            {s}
          </button>
        )}
      </For>
    </div>
  );
}

function Turn(props: { message: UiMessage; onSuggestion: (text: string) => void }) {
  return (
    <Show
      when={props.message.role === "assistant"}
      fallback={
        <div class="rounded-lg bg-muted px-3 py-2">
          <p class="text-sm whitespace-pre-wrap break-words leading-relaxed">
            {props.message.text}
          </p>
        </div>
      }
    >
      <div class="flex flex-col gap-2 px-0.5">
        <Show when={props.message.thinking}>
          <Thinking text={props.message.thinking!} />
        </Show>
        <Show when={props.message.tools.length}>
          <div class="flex flex-col gap-1">
            {/* Index, not For: tool_result patches the matching row in place
                (see useChat.ts) — keying by position keeps this robust even
                if that ever changes. */}
            <Index each={props.message.tools}>{t => <ToolRow tool={t()} />}</Index>
          </div>
        </Show>
        <Show when={props.message.text}>
          <p class="text-sm whitespace-pre-wrap break-words leading-relaxed text-neutral-800">
            <CitedText text={props.message.text} />
          </p>
        </Show>
        <Show when={props.message.suggestions?.length}>
          <SuggestionChips items={props.message.suggestions!} onPick={props.onSuggestion} />
        </Show>
      </div>
    </Show>
  );
}

const SUGGESTIONS = [
  "What's in flight right now?",
  "Anything waiting on review?",
  "Add a task to chase the lookbook edits",
];

export function MessageList(props: { chat: Chat }) {
  let scroller: HTMLDivElement | undefined;

  // Follow the stream, but don't yank the view if the user has scrolled up.
  // Coalesced to one rAF per burst — this effect fires on every streamed
  // delta, and reading scrollHeight/scrollTop/clientHeight synchronously that
  // often is a forced-layout read+write at token cadence (same class of fix
  // as the canvas camera/DotGrid work).
  let scrollRaf: number | null = null;
  onCleanup(() => {
    if (scrollRaf !== null) cancelAnimationFrame(scrollRaf);
  });
  createEffect(() => {
    props.chat.messages();
    if (!scroller || scrollRaf !== null) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = null;
      if (!scroller) return;
      const nearBottom =
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120;
      if (nearBottom) scroller.scrollTop = scroller.scrollHeight;
    });
  });

  function pickSuggestion(s: string) {
    props.chat.setInput(s);
    void props.chat.send();
  }

  return (
    <div ref={scroller} class="flex-1 min-h-0 overflow-y-auto px-2.5 py-2 flex flex-col gap-5">
      <Show
        when={props.chat.messages().length}
        fallback={
          <div class="m-auto w-full px-1">
            <p class="text-xs text-neutral-400 leading-relaxed">
              Ask about projects, deliverables, or tasks — or have me make the change.
            </p>
            <div class="mt-3">
              <SuggestionChips items={SUGGESTIONS} align="flush" onPick={pickSuggestion} />
            </div>
          </div>
        }
      >
        {/* Index, not For: useChat patches the last row in place per delta
            (text/thinking/tools) rather than replacing it. For keys by
            reference and would tear down + rebuild this subtree — including
            Thinking's local open-state signal — on every token. */}
        <Index each={props.chat.messages()}>
          {m => <Turn message={m()} onSuggestion={pickSuggestion} />}
        </Index>
      </Show>
    </div>
  );
}
