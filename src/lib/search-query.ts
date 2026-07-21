// Shared query-token parser for global search. Plain/isomorphic — used by
// both the client (GlobalSearch, for scope-token prefill/removal) and the
// server (search-api.ts, for interpreting the same tokens against the DB).
//
// Syntax is X-style: `key:value` or `key:"quoted value"` tokens mixed into
// free text, e.g. `entity:"Benzel-Busch" hero banner status:done`.

export type SearchKind = "entity" | "project" | "deliverable" | "task" | "media";

const KIND_ALIASES: Record<string, SearchKind> = {
  entity: "entity",
  entities: "entity",
  project: "project",
  projects: "project",
  deliverable: "deliverable",
  deliverables: "deliverable",
  task: "task",
  tasks: "task",
  media: "media",
  file: "media",
  files: "media",
  library: "media",
};

export interface ParsedSearchQuery {
  /** free text remaining after tokens are stripped */
  text: string;
  entity?: string;
  project?: string;
  type?: SearchKind;
  status?: string;
  assignee?: string;
  mine?: boolean;
}

const TOKEN_SOURCE = String.raw`(\w+):"([^"]*)"|(\w+):(\S+)`;

export function parseSearchQuery(raw: string): ParsedSearchQuery {
  const parsed: ParsedSearchQuery = { text: "" };
  const removeRanges: [number, number][] = [];
  const re = new RegExp(TOKEN_SOURCE, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) {
    const key = (match[1] ?? match[3])?.toLowerCase();
    const value = match[2] ?? match[4] ?? "";
    let recognized = true;
    switch (key) {
      case "entity":
      case "in":
        parsed.entity = value;
        break;
      case "project":
        parsed.project = value;
        break;
      case "type": {
        const k = KIND_ALIASES[value.toLowerCase()];
        if (k) parsed.type = k;
        else recognized = false;
        break;
      }
      case "status":
        parsed.status = value.toLowerCase().replace(/-/g, "_");
        break;
      case "assignee":
        parsed.assignee = value;
        break;
      case "is":
        if (value.toLowerCase() === "mine") parsed.mine = true;
        else recognized = false;
        break;
      default:
        recognized = false;
    }
    if (recognized) removeRanges.push([match.index, match.index + match[0].length]);
  }
  let text = "";
  let cursor = 0;
  for (const [start, end] of removeRanges) {
    text += raw.slice(cursor, start);
    cursor = end;
  }
  text += raw.slice(cursor);
  parsed.text = text.replace(/\s+/g, " ").trim();
  return parsed;
}

/**
 * Replace (or remove) the `entity:`/`project:` scope token at the front of a
 * query string, leaving the rest of the text untouched. Passing `value: null`
 * strips the token — this is how a prefilled scope gets "removed" by the user
 * editing/deleting it, or by us clearing it programmatically.
 */
export function withScopeToken(
  raw: string,
  kind: "entity" | "project",
  value: string | null,
): string {
  const removeRanges: [number, number][] = [];
  const re = new RegExp(TOKEN_SOURCE, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) {
    const key = (match[1] ?? match[3])?.toLowerCase();
    if (key === kind || (kind === "entity" && key === "in")) {
      removeRanges.push([match.index, match.index + match[0].length]);
    }
  }
  let stripped = "";
  let cursor = 0;
  for (const [start, end] of removeRanges) {
    stripped += raw.slice(cursor, start);
    cursor = end;
  }
  stripped += raw.slice(cursor);
  stripped = stripped.replace(/\s+/g, " ").trim();
  if (!value) return stripped;
  const token = /\s/.test(value) ? `${kind}:"${value}"` : `${kind}:${value}`;
  return stripped ? `${token} ${stripped}` : `${token} `;
}
