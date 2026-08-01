import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
} from "solid-js";
import { useNavigate } from "@solidjs/router";
import { Icon } from "@iconify-icon/solid";
import { globalSearch, type SearchResultItem } from "../lib/search-api";
import { withScopeToken, type SearchKind } from "../lib/search-query";
import { useScope } from "./ScopeProvider";

const GROUPS: { kind: SearchKind; label: string; icon: string }[] = [
  { kind: "entity", label: "Entities", icon: "iconoir:building" },
  { kind: "project", label: "Projects", icon: "iconoir:folder" },
  { kind: "deliverable", label: "Deliverables", icon: "iconoir:media-image" },
  { kind: "task", label: "Tasks", icon: "iconoir:task-list" },
  { kind: "media", label: "Media", icon: "iconoir:media-image-folder" },
];

const OPERATOR_HINTS = [
  "entity:name",
  "project:name",
  "type:task|project|deliverable|media|entity",
  "status:value",
  "assignee:name",
  "tag:name",
  "is:mine",
];

interface GlobalSearchProps {
  orgId: () => string | null;
  /** current project, when rendered on the canvas page — takes priority over entity scope for prefill */
  projectContext?: () => { id: string; name: string } | null;
  variant?: "inline" | "modal";
  modalOpen?: boolean;
  onModalClose?: () => void;
}

export function GlobalSearch(props: GlobalSearchProps) {
  const navigate = useNavigate();
  const scope = useScope();
  const isModal = () => props.variant === "modal";

  const [value, setValue] = createSignal("");
  // equals:false so clearing and retyping the *same* term still re-fires the
  // fetch effect (otherwise the setDebounced(sameString) is a no-op).
  const [debounced, setDebounced] = createSignal("", { equals: false });
  const [open, setOpen] = createSignal(false);
  const [activeIndex, setActiveIndex] = createSignal(0);
  let inputRef: HTMLInputElement | undefined;
  let wrapperRef: HTMLDivElement | undefined;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  createEffect(() => {
    const v = value();
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => setDebounced(v), 150);
  });
  onCleanup(() => clearTimeout(debounceTimer));

  // Deliberately NOT createResource: the whole app shares one root <Suspense>
  // boundary (app.tsx), and any resource that suspends anywhere suspends that
  // entire boundary — every keystroke's refetch would blank and remount the
  // whole page (and drop input focus with it). Plain signals never engage
  // Suspense, so this fetch is done by hand instead.
  const [results, setResults] = createSignal<SearchResultItem[]>([]);
  const [resultsLoading, setResultsLoading] = createSignal(false);

  createEffect(() => {
    const org = props.orgId();
    const text = debounced().trim();
    if (!org || !text) {
      setResults([]);
      setResultsLoading(false);
      return;
    }
    // Compose the active scope into the outgoing query only here — the visible
    // input stays pure free text. withScopeToken quotes the value correctly.
    const s = activeScope();
    const q = s ? withScopeToken(text, s.kind, s.value) : text;
    let cancelled = false;
    setResultsLoading(true);
    globalSearch(q)
      .then(r => {
        if (!cancelled) setResults(r);
      })
      .catch(() => {
        if (!cancelled) setResults([]);
      })
      .finally(() => {
        if (!cancelled) setResultsLoading(false);
      });
    onCleanup(() => {
      cancelled = true;
    });
  });

  const grouped = createMemo(() => {
    const rows = results();
    return GROUPS.map(g => ({ ...g, items: rows.filter(r => r.kind === g.kind) })).filter(
      g => g.items.length > 0,
    );
  });
  const flatItems = createMemo(() => grouped().flatMap(g => g.items));

  createEffect(() => {
    flatItems();
    setActiveIndex(0);
  });

  function scopeToken(): { kind: "project" | "entity"; value: string } | null {
    const proj = props.projectContext?.();
    if (proj) return { kind: "project", value: proj.name };
    const ent = scope.entity();
    if (ent) return { kind: "entity", value: ent.name };
    return null;
  }

  // Scope is UI state, never injected into the input text: the active
  // entity/project shows as a removable chip and is composed into the query
  // only at fetch time. This avoids the "cleared box snaps back to the token"
  // and malformed-token classes of bugs the token-in-text approach had.
  const [scopeDismissed, setScopeDismissed] = createSignal(false);
  const activeScope = () => (scopeDismissed() ? null : scopeToken());
  // Re-show the chip whenever the scope itself changes (e.g. switching
  // entities); keyed on a stable string so it fires only on real changes.
  const scopeKey = () => {
    const t = scopeToken();
    return t ? `${t.kind}:${t.value}` : "";
  };
  createEffect(on(scopeKey, () => setScopeDismissed(false)));

  function focusInput() {
    queueMicrotask(() => {
      if (!inputRef) return;
      inputRef.focus();
      inputRef.setSelectionRange(inputRef.value.length, inputRef.value.length);
    });
  }

  function closeSearch() {
    setOpen(false);
    if (isModal()) props.onModalClose?.();
    else inputRef?.blur();
  }

  function openResult(item: SearchResultItem) {
    switch (item.kind) {
      case "entity":
        if (item.entityId && item.entityName) scope.setEntity({ id: item.entityId, name: item.entityName });
        navigate("/");
        break;
      case "project":
        navigate(`/p/${item.projectId}`);
        break;
      case "deliverable":
        navigate(`/p/${item.projectId}/d/${item.deliverableId}`);
        break;
      case "task":
        navigate(`/tasks?task=${item.id}`);
        break;
      case "media":
        if (item.isMirror && item.projectId && item.deliverableId) {
          navigate(`/p/${item.projectId}/d/${item.deliverableId}`);
        } else {
          navigate(`/library?folder=${item.folderId}&file=${item.id}`);
        }
        break;
    }
    closeSearch();
  }

  function onKeyDown(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === "Escape") {
      closeSearch();
      return;
    }
    // Backspace on an empty query removes the scope chip (like deleting a token).
    if (e.key === "Backspace" && value() === "" && activeScope()) {
      e.preventDefault();
      setScopeDismissed(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex(i => Math.min(i + 1, flatItems().length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex(i => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      const item = flatItems()[activeIndex()];
      if (item) openResult(item);
    }
  }

  // inline variant: global "/" focuses the search box, unless typing elsewhere.
  // Solid delegates click handling at the document level, so a plain
  // stopPropagation() inside the wrapper's onClick does not stop this
  // separately-registered raw listener from also seeing the same click —
  // it must explicitly check containment instead of assuming "reached
  // document" means "was outside".
  if (!isModal()) {
    onMount(() => {
      function onGlobalKey(e: KeyboardEvent) {
        const t = e.target as HTMLElement;
        const typing = t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable;
        if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
        if (e.key === "/") {
          e.preventDefault();
          setOpen(true);
          focusInput();
        }
      }
      function onDocClick(e: MouseEvent) {
        if (wrapperRef && e.target instanceof Node && wrapperRef.contains(e.target)) return;
        setOpen(false);
      }
      window.addEventListener("keydown", onGlobalKey);
      document.addEventListener("click", onDocClick);
      onCleanup(() => {
        window.removeEventListener("keydown", onGlobalKey);
        document.removeEventListener("click", onDocClick);
      });
    });
  }

  // modal variant: react to external open/close
  createEffect(() => {
    if (isModal() && props.modalOpen) {
      setOpen(true);
      focusInput();
    }
  });

  // Function components (not precomputed JSX constants) — each of the two
  // mutually-exclusive branches below invokes its own instance, so Solid's
  // hydration-key numbering stays consistent between server and client.
  function ResultsPanel() {
    return (
      <div class="max-h-96 overflow-y-auto py-1">
        <Show
          when={debounced().trim()}
          fallback={
            <div class="px-3 py-3">
              <p class="text-xs text-neutral-400 mb-2">
                Search entities, projects, deliverables, tasks, and media.
              </p>
              <div class="flex flex-wrap gap-1.5">
                <For each={OPERATOR_HINTS}>
                  {h => (
                    <span class="text-[10px] font-mono text-neutral-500 bg-neutral-100 rounded px-1.5 py-0.5">
                      {h}
                    </span>
                  )}
                </For>
              </div>
            </div>
          }
        >
          <Show
            when={!resultsLoading()}
            fallback={<p class="px-3 py-4 text-xs text-neutral-400">Searching…</p>}
          >
            <Show
              when={grouped().length > 0}
              fallback={
                <p class="px-3 py-4 text-xs text-neutral-400">
                  No results for “{debounced().trim()}”.
                </p>
              }
            >
              <For each={grouped()}>
                {group => {
                  const startIndex = () =>
                    grouped()
                      .slice(0, grouped().indexOf(group))
                      .reduce((n, g) => n + g.items.length, 0);
                  return (
                    <div>
                      <p class="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-neutral-400">
                        {group.label}
                      </p>
                      <For each={group.items}>
                        {(item, i) => (
                          <button
                            class="w-full flex items-center gap-2.5 px-3 py-1.5 text-left cursor-pointer"
                            classList={{ "bg-neutral-100": startIndex() + i() === activeIndex() }}
                            onMouseEnter={() => setActiveIndex(startIndex() + i())}
                            onClick={() => openResult(item)}
                          >
                            <Icon icon={group.icon} width="14" class="text-neutral-400 shrink-0" />
                            <span class="min-w-0 flex-1">
                              <span class="block text-sm text-neutral-800 truncate">{item.title}</span>
                              <Show when={item.subtitle}>
                                <span class="block text-[11px] text-neutral-400 truncate">
                                  {item.subtitle}
                                </span>
                              </Show>
                            </span>
                            <Show when={item.kind === "media" && item.isMirror}>
                              <span class="shrink-0 text-[10px] text-neutral-400 bg-neutral-100 rounded px-1 py-0.5">
                                canvas
                              </span>
                            </Show>
                          </button>
                        )}
                      </For>
                    </div>
                  );
                }}
              </For>
            </Show>
          </Show>
        </Show>
      </div>
    );
  }

  function ScopeChip() {
    return (
      <Show when={activeScope()}>
        {s => (
          <span class="shrink-0 flex items-center gap-1 text-[11px] bg-neutral-100 text-neutral-600 rounded px-1.5 py-0.5 max-w-[45%]">
            <Icon
              icon={s().kind === "project" ? "iconoir:folder" : "iconoir:building"}
              width="11"
              class="shrink-0 text-neutral-400"
            />
            <span class="truncate">{s().value}</span>
            <button
              class="shrink-0 text-neutral-400 hover:text-neutral-700 cursor-pointer flex items-center"
              title="Search everywhere (remove scope)"
              onClick={e => {
                e.stopPropagation();
                setScopeDismissed(true);
                inputRef?.focus();
              }}
            >
              <Icon icon="iconoir:xmark" width="11" />
            </button>
          </span>
        )}
      </Show>
    );
  }

  function SearchField() {
    return (
      <input
        ref={inputRef}
        class="flex-1 min-w-0 outline-none bg-transparent placeholder:text-neutral-400"
        classList={{ "text-sm": isModal(), "text-xs": !isModal() }}
        placeholder="Search…"
        value={value()}
        onInput={e => setValue(e.currentTarget.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
    );
  }

  if (isModal()) {
    return (
      <Show when={props.modalOpen}>
        <div
          class="fixed inset-0 z-50 bg-black/10 dark:bg-black/50 flex items-start justify-center pt-[18vh]"
          onClick={closeSearch}
        >
          <div
            class="w-[520px] max-w-[90vw] bg-panel rounded-xl shadow-2xl border border-neutral-200 overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div class="flex items-center gap-2 px-3 py-2.5 border-b border-neutral-100">
              <Icon icon="iconoir:search" width="15" class="text-neutral-400" />
              <ScopeChip />
              <SearchField />
              <span class="text-[10px] text-neutral-400 bg-neutral-100 rounded px-1 py-0.5">Esc</span>
            </div>
            <ResultsPanel />
          </div>
        </div>
      </Show>
    );
  }

  return (
    <div ref={wrapperRef} class="relative w-full max-w-md" onClick={e => e.stopPropagation()}>
      <div class="flex items-center gap-2 px-2.5 py-1.5 rounded-lg outline outline-neutral-200/80 bg-panel/60 focus-within:bg-panel focus-within:outline-neutral-300">
        <Icon icon="iconoir:search" width="13" class="text-neutral-400 shrink-0" />
        <ScopeChip />
        <SearchField />
        <Show when={!open()}>
          <span class="shrink-0 text-[10px] text-neutral-400 bg-neutral-100 rounded px-1 py-0.5">/</span>
        </Show>
      </div>
      <Show when={open()}>
        <div class="absolute top-full left-0 mt-1 w-[420px] max-w-[90vw] bg-panel border border-neutral-200 rounded-lg shadow-xl z-30">
          <ResultsPanel />
        </div>
      </Show>
    </div>
  );
}
