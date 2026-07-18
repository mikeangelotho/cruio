import { For } from "solid-js";
import type { Phase } from "../lib/types";

const PHASES: { key: Phase; label: string }[] = [
  { key: "pre_production", label: "Pre-production" },
  { key: "iterations", label: "Iterations" },
  { key: "publishing", label: "Publishing" },
];

/**
 * Phases are status, not navigation (whitepaper §4) — this is a read-only
 * indicator of where the project is.
 */
export function StatusRail(props: { phase: Phase }) {
  const activeIdx = () => PHASES.findIndex(p => p.key === props.phase);
  return (
    <div class="flex items-center gap-1 select-none" title="Project phase">
      <For each={PHASES}>
        {(p, i) => (
          <div class="flex items-center gap-1">
            {i() > 0 && <div class="w-4 h-px bg-neutral-200" />}
            <div
              class="flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full transition-colors"
              classList={{
                "bg-neutral-800 text-white": i() === activeIdx(),
                "text-neutral-400": i() !== activeIdx(),
              }}
            >
              <span
                class="size-1.5 rounded-full"
                classList={{
                  "bg-emerald-400": i() < activeIdx(),
                  "bg-white": i() === activeIdx(),
                  "bg-neutral-300": i() > activeIdx(),
                }}
              />
              {p.label}
            </div>
          </div>
        )}
      </For>
    </div>
  );
}
