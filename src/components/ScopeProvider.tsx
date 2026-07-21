import {
  createContext,
  createMemo,
  createSignal,
  on,
  createEffect,
  useContext,
  type JSX,
} from "solid-js";
import { isServer, getRequestEvent } from "solid-js/web";
import { createAsync } from "@solidjs/router";
import { sessionQuery } from "../lib/org-api";

export interface ScopeEntity {
  id: string;
  name: string;
}

interface ScopeValue {
  /** Active org id (null while signed out / loading). */
  orgId: () => string | null;
  /** Currently selected entity, or null = "All Entities". */
  entity: () => ScopeEntity | null;
  setEntity: (e: ScopeEntity | null) => void;
}

const ScopeContext = createContext<ScopeValue>();

// The cookie is persistence only — server functions never trust it for
// authorization; they take entityId as an explicit, validated argument.
const cookieName = (orgId: string) => `cruio_entity_${orgId}`;

function readCookie(name: string): ScopeEntity | null {
  const source = isServer
    ? (getRequestEvent()?.request.headers.get("cookie") ?? "")
    : document.cookie;
  for (const part of source.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) {
      try {
        const parsed = JSON.parse(decodeURIComponent(rest.join("=")));
        if (parsed && typeof parsed.id === "string" && typeof parsed.name === "string") {
          return { id: parsed.id, name: parsed.name };
        }
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function ScopeProvider(props: { children: JSX.Element }) {
  const session = createAsync(() => sessionQuery());
  const orgId = () => session()?.activeOrganizationId ?? null;

  // Cookie is the source of truth; the override carries an in-session change
  // so the memo updates immediately (document.cookie isn't reactive).
  const [override, setOverride] = createSignal<{ value: ScopeEntity | null } | null>(null);

  // switching workspaces drops the override so the new org's cookie applies
  createEffect(on(orgId, () => setOverride(null), { defer: true }));

  const entity = createMemo<ScopeEntity | null>(() => {
    const o = override();
    if (o) return o.value;
    const org = orgId();
    return org ? readCookie(cookieName(org)) : null;
  });

  function setEntity(e: ScopeEntity | null) {
    setOverride({ value: e });
    const org = orgId();
    if (org && !isServer) {
      document.cookie = e
        ? `${cookieName(org)}=${encodeURIComponent(JSON.stringify(e))}; path=/; max-age=31536000; samesite=lax`
        : `${cookieName(org)}=; path=/; max-age=0; samesite=lax`;
    }
  }

  return (
    <ScopeContext.Provider value={{ orgId, entity, setEntity }}>
      {props.children}
    </ScopeContext.Provider>
  );
}

export function useScope(): ScopeValue {
  const ctx = useContext(ScopeContext);
  if (!ctx) throw new Error("useScope must be used inside <ScopeProvider>");
  return ctx;
}
