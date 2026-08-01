import { Show, createSignal } from "solid-js";
import { A, createAsync, useNavigate } from "@solidjs/router";
import { Icon } from "@iconify-icon/solid";
import { authClient } from "../lib/auth-client";
import { sessionQuery } from "../lib/org-api";

export const route = { preload: () => sessionQuery() };

export default function SignIn() {
  const navigate = useNavigate();
  const session = createAsync(() => sessionQuery());
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  // inverse guard: already signed in → home
  const redirectIfAuthed = () => {
    if (session()) navigate("/", { replace: true });
    return null;
  };

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const email = (form.elements.namedItem("email") as HTMLInputElement).value.trim();
    const password = (form.elements.namedItem("password") as HTMLInputElement).value;
    if (!email || !password) return;
    setBusy(true);
    setError("");
    const res = await authClient.signIn.email({ email, password });
    setBusy(false);
    if (res.error) {
      setError(res.error.message ?? "Sign-in failed");
      return;
    }
    navigate("/", { replace: true });
  }

  return (
    <div class="p-1 h-screen bg-canvas">
      {redirectIfAuthed()}
      <div class="rounded-lg w-full h-full border border-line flex items-center justify-center">
        <div class="w-[340px] max-w-[90vw]">
          <div class="mb-6 text-center">
            <span class="text-sm font-semibold tracking-tight text-neutral-800">cruio</span>
            <p class="mt-1 text-xs text-neutral-400">creative pipeline</p>
          </div>
          <form
            onSubmit={submit}
            class="p-5 border border-neutral-200 rounded-lg bg-panel flex flex-col gap-3"
          >
            <h1 class="text-sm font-semibold text-neutral-800">Sign in</h1>
            <label class="text-xs text-neutral-500">
              Email
              <input
                name="email"
                type="email"
                required
                autocomplete="email"
                class="mt-1 w-full text-sm border border-neutral-200 rounded px-2 py-1.5 outline-none focus:border-sky-400"
                placeholder="you@studio.com"
                ref={el => queueMicrotask(() => el.focus())}
              />
            </label>
            <label class="text-xs text-neutral-500">
              Password
              <input
                name="password"
                type="password"
                required
                autocomplete="current-password"
                class="mt-1 w-full text-sm border border-neutral-200 rounded px-2 py-1.5 outline-none focus:border-sky-400"
              />
            </label>
            <Show when={error()}>
              <p class="text-xs text-rose-600">{error()}</p>
            </Show>
            <button
              type="submit"
              disabled={busy()}
              class="mt-1 flex items-center justify-center gap-1 text-xs bg-brand text-on-brand rounded px-3 py-2 hover:bg-neutral-700 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Show when={busy()} fallback={<>Sign in</>}>
                <Icon icon="iconoir:refresh" width="12" class="animate-spin" /> Signing in…
              </Show>
            </button>
          </form>
          <p class="mt-3 text-center text-xs text-neutral-400">
            New here?{" "}
            <A href="/sign-up" class="text-neutral-700 hover:underline">
              Create an account
            </A>
          </p>
        </div>
      </div>
    </div>
  );
}
