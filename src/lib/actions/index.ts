import { ACTIONS, ACTIONS_BY_NAME } from "./catalog";
import { jsonSchemaFor, type JsonSchema } from "./define";
import { translateError, validateInput, type ActionError } from "./errors";

export type { ActionError } from "./errors";
export { ACTIONS, ACTIONS_BY_NAME } from "./catalog";

export type InvokeResult =
  | { ok: true; result: unknown; summary?: string; mutated: boolean }
  | { ok: false; error: ActionError };

export type ToolDefinition = {
  name: string;
  title: string;
  description: string;
  input_schema: JsonSchema;
  mutates: boolean;
  danger: boolean;
};

/**
 * Built once at module load, sorted by name. Tool definitions render at
 * position 0 of the prompt, so any byte change invalidates the tools, system,
 * AND messages cache tiers — the ordering must not depend on import order or
 * object-key iteration.
 */
const DEFINITIONS: ToolDefinition[] = ACTIONS.map(a => ({
  name: a.name,
  title: a.title,
  description: a.description,
  input_schema: jsonSchemaFor(a),
  mutates: a.mutates,
  danger: a.danger ?? false,
})).sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));

export function toolDefinitions(): ToolDefinition[] {
  return DEFINITIONS;
}

/** Stable fingerprint — used by the boot assertion and cache debugging. */
export function toolsFingerprint(): string {
  return JSON.stringify(
    DEFINITIONS.map(d => [d.name, d.description, d.input_schema]),
  );
}

/**
 * Run an action by name. Never throws: every failure comes back as a typed
 * error so the model can correct itself instead of the turn dying.
 */
export async function invokeAction(
  name: string,
  rawInput: unknown,
): Promise<InvokeResult> {
  const action = ACTIONS_BY_NAME.get(name);
  if (!action) {
    return {
      ok: false,
      error: { code: "not_found", message: `Unknown tool "${name}".` },
    };
  }

  const parsed = validateInput(action.schema, rawInput);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  try {
    const result = await action.run(parsed.value);
    return {
      ok: true,
      result,
      summary: action.summarize?.(result),
      mutated: action.mutates,
    };
  } catch (e) {
    return { ok: false, error: translateError(e) };
  }
}
