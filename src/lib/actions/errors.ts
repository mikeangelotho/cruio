import * as v from "valibot";

// The existing server functions signal failure in three different shapes.
// Translate them into something a model can actually act on.

export type ActionErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "invalid_input"
  | "failed";

export type ActionError = {
  code: ActionErrorCode;
  message: string;
  issues?: Record<string, [string, ...string[]] | undefined>;
};

/**
 * guard.ts:requireSession() throws `redirect("/sign-in")`, which is a
 * `Response` — not an Error. `e.message` is undefined and String(e) is
 * "[object Response]", so anything that assumes Error here swallows auth
 * failures silently.
 */
export function translateError(e: unknown): ActionError {
  if (e instanceof Response) {
    const location = e.headers.get("Location");
    if (e.status >= 300 && e.status < 400 && location?.includes("/sign-in")) {
      return { code: "unauthenticated", message: "Not signed in." };
    }
    return { code: "failed", message: `Request failed (${e.status}).` };
  }

  if (e instanceof Error) {
    switch (e.message) {
      case "Forbidden":
        return {
          code: "forbidden",
          message: "You do not have permission to do that in this workspace.",
        };
      case "Not found":
        return { code: "not_found", message: "That record does not exist." };
      case "Invalid input":
        return { code: "invalid_input", message: "One or more arguments were invalid." };
      default:
        return { code: "failed", message: e.message };
    }
  }

  return { code: "failed", message: String(e) };
}

/**
 * Pre-validate at the registry boundary. parseOrThrow inside the server
 * functions discards valibot's issues and throws a bare "Invalid input", so
 * without this the model gets no idea which argument was wrong.
 */
export function validateInput<S extends v.GenericSchema>(
  schema: S,
  input: unknown,
): { ok: true; value: v.InferOutput<S> } | { ok: false; error: ActionError } {
  const result = v.safeParse(schema, input ?? {});
  if (result.success) return { ok: true, value: result.output };
  const flat = v.flatten(result.issues);
  return {
    ok: false,
    error: {
      code: "invalid_input",
      message:
        flat.root?.join("; ") ??
        Object.entries(flat.nested ?? {})
          .map(([k, msgs]) => `${k}: ${msgs?.join(", ")}`)
          .join("; ") ??
        "Invalid input.",
      issues: flat.nested,
    },
  };
}
