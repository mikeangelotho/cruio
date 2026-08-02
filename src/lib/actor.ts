import { AsyncLocalStorage } from "node:async_hooks";
import { getRequestEvent } from "solid-js/web";
import { provideRequestEvent } from "solid-js/web/storage";
import type { OrgRole } from "./permissions";

// Server-only. Lets non-browser callers (MCP, the AI agent loop) run the
// existing "use server" functions as a specific user.
//
// Two things have to be true for that to work, and they are separate:
//
//  1. guard.ts must resolve a session. Browser requests carry a cookie;
//     an MCP request carries a bearer token, so there is no cookie for
//     better-auth to read. The ALS below is what getSession() falls back to.
//
//  2. There must be an ambient Solid request event. Every "use server"
//     function is wrapped in a Proxy (@solidjs/start/dist/server/
//     server-fns-runtime.js) that throws "Cannot call server function
//     outside of a request" when getRequestEvent() is empty, and that
//     mutates event.locals — so the event must be a real object with a
//     locals bag. API routes already have one (decorateHandler in
//     dist/server/fetchEvent.js wraps the whole handler), which covers
//     every caller we have today.

export type Actor = {
  userId: string;
  name: string;
  email: string;
  /** The workspace this call is scoped to. MCP bearer tokens have no
   *  better-auth session row, so this cannot be inferred — see resolveOrg. */
  organizationId: string | null;
  role: OrgRole;
  source: "chat" | "mcp";
};

const store = new AsyncLocalStorage<Actor>();

export function getActor(): Actor | undefined {
  return store.getStore();
}

/**
 * Fallback for callers with no ambient request event (a queue worker, a
 * resumed background turn). Everything we run today goes through an API
 * route, so this is defensive; `request` carries the actor's identity only
 * so that anything reading headers gets something coherent rather than a
 * crash.
 */
function syntheticEvent(actor: Actor) {
  return {
    request: new Request("http://localhost/_actor", {
      headers: { "x-cruio-actor": actor.userId },
    }),
    response: { headers: new Headers() },
    locals: {},
    nativeEvent: undefined,
  } as unknown as Parameters<typeof provideRequestEvent>[0];
}

/** Run `fn` as `actor`. Nests safely; the innermost actor wins. */
export function runAsActor<T>(actor: Actor, fn: () => T): T {
  const event = getRequestEvent() ?? syntheticEvent(actor);
  return store.run(actor, () => provideRequestEvent(event, fn));
}
