import { Show, createSignal } from "solid-js";
import { createAsync, revalidate, useNavigate } from "@solidjs/router";
import { Icon } from "@iconify-icon/solid";
import { authClient } from "../lib/auth-client";
import { myOrgsQuery, requireUserQuery, sessionQuery } from "../lib/org-api";

export const route = { preload: () => requireUserQuery() };

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "studio"}-${Math.random().toString(36).slice(2, 6)}`;
}

export default function Onboarding() {
  const navigate = useNavigate();
  const user = createAsync(() => requireUserQuery());
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const name = (form.elements.namedItem("name") as HTMLInputElement).value.trim();
    if (!name) return;
    setBusy(true);
    setError("");
    const res = await authClient.organization.create({ name, slug: slugify(name) });
    if (res.error || !res.data) {
      setBusy(false);
      setError(res.error?.message ?? "Could not create the studio");
      return;
    }
    await authClient.organization.setActive({ organizationId: res.data.id });
    // refresh the auth caches so "/" sees the new org instead of the stale
    // empty list that would bounce us right back into onboarding
    await revalidate([sessionQuery.key, requireUserQuery.key, myOrgsQuery.key]);
    setBusy(false);
    navigate("/", { replace: true });
  }

  return (
    <div class="p-1 h-full bg-canvas">
      <div class="rounded-lg w-full h-full border border-line flex items-center justify-center">
        <div class="w-[380px] max-w-[90vw]">
          <div class="mb-6 text-center">
            <span class="text-sm font-semibold tracking-tight text-neutral-800">cruio</span>
            <p class="mt-1 text-xs text-neutral-400">
              Welcome{user()?.name ? `, ${user()!.name}` : ""}
            </p>
          </div>
          <form
            onSubmit={submit}
            class="p-5 border border-neutral-200 rounded-lg bg-panel flex flex-col gap-3"
          >
            <h1 class="text-sm font-semibold text-neutral-800">Name your studio</h1>
            <p class="text-xs text-neutral-400 leading-relaxed">
              Your studio is the workspace that holds your team, clients, and projects.
            </p>
            <input
              name="name"
              required
              class="w-full text-sm border border-neutral-200 rounded px-2 py-1.5 outline-none focus:border-sky-400"
              placeholder="e.g. Acme Studio"
              ref={el => queueMicrotask(() => el.focus())}
            />
            <Show when={error()}>
              <p class="text-xs text-rose-600">{error()}</p>
            </Show>
            <button
              type="submit"
              disabled={busy()}
              class="mt-1 flex items-center justify-center gap-1 text-xs bg-brand text-on-brand rounded px-3 py-2 hover:bg-neutral-700 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Show when={busy()} fallback={<>Create studio</>}>
                <Icon icon="iconoir:refresh" width="12" class="animate-spin" /> Creating…
              </Show>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
