import * as v from "valibot";
import { toJsonSchema } from "@valibot/to-json-schema";
import type { Resource } from "../permissions";

// Server-only. One definition per user-facing action, consumed by both the
// chat agent loop and the MCP server.
//
// Input schemas are authored HERE rather than reused from validate.ts on
// purpose: @valibot/to-json-schema cannot convert `trim`, `finite`, `check`,
// or `transform`, which covers most of validate.ts. Worse, in "ignore" mode
// it stops at the first transformation and silently drops the constraints
// after it. So these schemas describe the wire format for the model, and
// validate.ts stays the enforcement layer inside the server functions.

export type ActionInput = v.GenericSchema;

export type Action<S extends ActionInput = ActionInput> = {
  name: string;
  /** Human label shown in the chat tool row and as the MCP annotation title. */
  title: string;
  description: string;
  schema: S;
  /** false => read-only; drives MCP readOnlyHint and skips invalidation. */
  mutates: boolean;
  /** true => pause for explicit user approval before running. */
  danger?: boolean;
  /** Documentation only — the real check is authorize() inside the server fn. */
  permission?: { resource: Resource; action: string };
  run: (input: v.InferOutput<S>) => Promise<unknown>;
  /** One-line result summary for the chat tool row. */
  summarize?: (result: unknown) => string;
};

export function defineAction<S extends ActionInput>(a: Action<S>): Action<S> {
  return a;
}

export type JsonSchema = {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  [k: string]: unknown;
};

/**
 * errorMode "throw" so an unconvertible schema fails at module load rather
 * than silently shipping a lossy one to the model.
 */
export function jsonSchemaFor(action: Action): JsonSchema {
  const schema = toJsonSchema(action.schema, { errorMode: "throw" }) as JsonSchema;
  // The wire type requires an object at the top level even for no-arg tools.
  if (schema.type !== "object") {
    throw new Error(`Action ${action.name}: input schema must be an object`);
  }
  return schema;
}

/** No-argument actions still need an object schema. */
export const NoArgs = v.object({});

/** A trimmed, bounded string that the JSON Schema converter can represent. */
export const Text = (max = 120) =>
  v.pipe(v.string(), v.minLength(1), v.maxLength(max));

export const Uuid = v.pipe(v.string(), v.uuid());
