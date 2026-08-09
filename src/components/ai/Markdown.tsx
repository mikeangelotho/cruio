import { For, Show, createSignal, type JSX } from "solid-js";
import { A } from "@solidjs/router";
import { Icon } from "@iconify-icon/solid";
import { pushToast } from "../../lib/toast";

/**
 * A small, dependency-free markdown renderer for assistant messages. XSS-safe by
 * construction: every piece of model text lands in a JSX text node, never
 * innerHTML. Covers the common "AI portal" set — headings, bold/italic, inline
 * and fenced code (with a copy button), ordered/unordered lists, blockquotes,
 * pipe tables, links, and the app's own `[[type:id|Label]]` citation syntax.
 *
 * Streaming-safe: re-parses the whole string on each delta (cheap at chat
 * lengths). An unterminated code fence renders as an open block to end-of-text;
 * unclosed inline markers just fall through as literal characters.
 */

// ---- inline ---------------------------------------------------------------

const CITATION_RE = /\[\[(project|task):([0-9a-f-]+)\|([^\]]+)\]\]/;
const LINK_RE = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/;
const BOLD_RE = /\*\*([^*]+)\*\*|__([^_]+)__/;
const ITALIC_RE = /\*([^*\n]+)\*|_([^_\n]+)_/;
const CODE_RE = /`([^`\n]+)`/;
const AUTOLINK_RE = /(https?:\/\/[^\s<>()]+)/;

function citationHref(type: string, id: string): string {
  return type === "task" ? `/tasks?task=${id}` : `/p/${id}`;
}

type Match = { index: number; length: number; node: JSX.Element };

/** Find the earliest inline construct in `text` from the current position. */
function firstInline(text: string): Match | null {
  let best: (Match & { pri: number }) | null = null;
  const consider = (re: RegExp, pri: number, make: (m: RegExpMatchArray) => JSX.Element) => {
    const m = text.match(re);
    if (!m || m.index == null) return;
    // earliest wins; ties broken by priority (lower = higher precedence)
    if (!best || m.index < best.index || (m.index === best.index && pri < best.pri)) {
      best = { index: m.index, length: m[0].length, node: make(m), pri };
    }
  };
  // code first: its content is literal (no nested parsing)
  consider(CODE_RE, 0, m => (
    <code class="px-1 py-0.5 rounded bg-muted text-[0.85em] font-mono text-neutral-800 break-words">
      {m[1]}
    </code>
  ));
  consider(CITATION_RE, 1, m => (
    <A href={citationHref(m[1], m[2])} class="text-sky-700 hover:text-sky-900 underline underline-offset-2">
      {m[3]}
    </A>
  ));
  consider(LINK_RE, 2, m => (
    <a href={m[2]} target="_blank" rel="noopener noreferrer" class="text-sky-700 hover:text-sky-900 underline underline-offset-2 break-words">
      {parseInline(m[1])}
    </a>
  ));
  consider(BOLD_RE, 3, m => <strong class="font-semibold">{parseInline(m[1] ?? m[2])}</strong>);
  consider(ITALIC_RE, 4, m => <em class="italic">{parseInline(m[1] ?? m[2])}</em>);
  consider(AUTOLINK_RE, 5, m => (
    <a href={m[1]} target="_blank" rel="noopener noreferrer" class="text-sky-700 hover:text-sky-900 underline underline-offset-2 break-words">
      {m[1]}
    </a>
  ));
  return best;
}

/** Recursively render inline markdown to an array of JSX nodes. */
function parseInline(text: string): JSX.Element[] {
  const out: JSX.Element[] = [];
  let rest = text;
  let guard = 0;
  while (rest && guard++ < 500) {
    const m = firstInline(rest);
    if (!m) {
      out.push(rest);
      break;
    }
    if (m.index > 0) out.push(rest.slice(0, m.index));
    out.push(m.node);
    rest = rest.slice(m.index + m.length);
  }
  return out;
}

/** Inline text that renders single newlines as <br> (soft breaks kept). */
function InlineText(props: { text: string }): JSX.Element {
  const lines = () => props.text.split("\n");
  return (
    <For each={lines()}>
      {(line, i) => (
        <>
          <Show when={i() > 0}>
            <br />
          </Show>
          {parseInline(line)}
        </>
      )}
    </For>
  );
}

// ---- code block -----------------------------------------------------------

function CodeBlock(props: { lang: string; code: string }): JSX.Element {
  const [copied, setCopied] = createSignal(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(props.code);
      setCopied(true);
      pushToast("Code copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      pushToast("Couldn't copy");
    }
  }
  return (
    <div class="rounded-md border border-neutral-200 overflow-hidden bg-muted">
      <div class="flex items-center justify-between h-7 pl-2.5 pr-1.5 border-b border-neutral-200 text-[10px] text-neutral-500">
        <span class="font-mono uppercase tracking-wide">{props.lang || "code"}</span>
        <button
          type="button"
          class="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-neutral-200/60 cursor-pointer"
          onClick={copy}
        >
          <Icon icon={copied() ? "iconoir:check" : "iconoir:copy"} width="11" />
          {copied() ? "Copied" : "Copy"}
        </button>
      </div>
      <pre class="overflow-x-auto p-2.5 text-[12px] leading-relaxed font-mono text-neutral-800">
        <code>{props.code}</code>
      </pre>
    </div>
  );
}

// ---- block parsing --------------------------------------------------------

type Block =
  | { t: "code"; lang: string; code: string }
  | { t: "heading"; level: number; text: string }
  | { t: "hr" }
  | { t: "quote"; text: string }
  | { t: "ul"; items: string[] }
  | { t: "ol"; items: string[] }
  | { t: "table"; header: string[]; rows: string[][] }
  | { t: "p"; text: string };

const isBlank = (l: string) => l.trim() === "";
const HEADING = /^(#{1,6})\s+(.*)$/;
const HR = /^\s*([-*_])(\s*\1){2,}\s*$/;
const UL = /^\s*[-*+]\s+(.*)$/;
const OL = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const FENCE = /^\s*```(\w*)\s*$/;
const TABLE_SEP = /^\s*\|?[\s:|-]+\|?\s*$/;

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map(c => c.trim());
}

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (isBlank(line)) {
      i++;
      continue;
    }

    // fenced code (streaming-safe: no closing fence ⇒ run to EOF)
    const fence = line.match(FENCE);
    if (fence) {
      const lang = fence[1] ?? "";
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) body.push(lines[i++]);
      if (i < lines.length) i++; // consume closing fence
      blocks.push({ t: "code", lang, code: body.join("\n") });
      continue;
    }

    if (HR.test(line)) {
      blocks.push({ t: "hr" });
      i++;
      continue;
    }

    const h = line.match(HEADING);
    if (h) {
      blocks.push({ t: "heading", level: h[1].length, text: h[2] });
      i++;
      continue;
    }

    // pipe table: a row followed by a separator row
    if (line.includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes("|")) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && !isBlank(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push({ t: "table", header, rows });
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        body.push(lines[i].match(QUOTE)![1]);
        i++;
      }
      blocks.push({ t: "quote", text: body.join("\n") });
      continue;
    }

    if (UL.test(line)) {
      const items: string[] = [];
      while (i < lines.length && UL.test(lines[i])) {
        items.push(lines[i].match(UL)![1]);
        i++;
      }
      blocks.push({ t: "ul", items });
      continue;
    }

    if (OL.test(line)) {
      const items: string[] = [];
      while (i < lines.length && OL.test(lines[i])) {
        items.push(lines[i].match(OL)![1]);
        i++;
      }
      blocks.push({ t: "ol", items });
      continue;
    }

    // paragraph: consecutive lines until blank or a new block starts
    const para: string[] = [];
    while (
      i < lines.length &&
      !isBlank(lines[i]) &&
      !FENCE.test(lines[i]) &&
      !HR.test(lines[i]) &&
      !HEADING.test(lines[i]) &&
      !UL.test(lines[i]) &&
      !OL.test(lines[i]) &&
      !QUOTE.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push({ t: "p", text: para.join("\n") });
  }
  return blocks;
}

const HEADING_CLASS: Record<number, string> = {
  1: "text-base font-semibold mt-1",
  2: "text-sm font-semibold mt-1",
  3: "text-sm font-semibold",
  4: "text-[13px] font-semibold",
  5: "text-xs font-semibold",
  6: "text-xs font-semibold text-neutral-500",
};

function BlockView(props: { block: Block }): JSX.Element {
  const b = props.block;
  switch (b.t) {
    case "code":
      return <CodeBlock lang={b.lang} code={b.code} />;
    case "hr":
      return <hr class="border-neutral-200" />;
    case "heading":
      return (
        <p class={`${HEADING_CLASS[b.level] ?? "text-sm font-semibold"} text-neutral-800`}>
          <InlineText text={b.text} />
        </p>
      );
    case "quote":
      return (
        <blockquote class="border-l-2 border-neutral-200 pl-3 text-neutral-600 italic">
          <InlineText text={b.text} />
        </blockquote>
      );
    case "ul":
      return (
        <ul class="list-disc pl-5 flex flex-col gap-0.5 marker:text-neutral-400">
          <For each={b.items}>{it => <li><InlineText text={it} /></li>}</For>
        </ul>
      );
    case "ol":
      return (
        <ol class="list-decimal pl-5 flex flex-col gap-0.5 marker:text-neutral-400">
          <For each={b.items}>{it => <li><InlineText text={it} /></li>}</For>
        </ol>
      );
    case "table":
      return (
        <div class="overflow-x-auto">
          <table class="text-xs border border-neutral-200 rounded overflow-hidden border-collapse">
            <thead class="bg-muted">
              <tr>
                <For each={b.header}>
                  {c => <th class="text-left font-semibold px-2 py-1 border border-neutral-200"><InlineText text={c} /></th>}
                </For>
              </tr>
            </thead>
            <tbody>
              <For each={b.rows}>
                {row => (
                  <tr>
                    <For each={b.header}>
                      {(_, ci) => <td class="px-2 py-1 border border-neutral-200 align-top"><InlineText text={row[ci()] ?? ""} /></td>}
                    </For>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      );
    case "p":
      return (
        <p class="text-sm leading-relaxed text-neutral-800 break-words">
          <InlineText text={b.text} />
        </p>
      );
  }
}

export function Markdown(props: { text: string }): JSX.Element {
  const blocks = () => parseBlocks(props.text);
  return (
    <div class="flex flex-col gap-2">
      <For each={blocks()}>{b => <BlockView block={b} />}</For>
    </div>
  );
}
