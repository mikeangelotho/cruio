import { Match, Show, Switch, createResource, createSignal } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import { Icon } from "@iconify-icon/solid";
import { authClient } from "../../lib/auth-client";
import {
  claimInvitationGrants,
  getInvitationPublic,
  getSessionUser,
} from "../../lib/org-api";

/**
 * Invite accept flow: the invite link is copied out of the members page and
 * opened by the invitee. better-auth requires the accepting account to match
 * the invited email, so sign-up/sign-in here has the email prefilled + locked.
 */
export default function InvitePage() {
  const params = useParams();
  const navigate = useNavigate();
  const [inv] = createResource(() => params.id, getInvitationPublic);
  const [session, { refetch: refetchSession }] = createResource(getSessionUser);

  const [mode, setMode] = createSignal<"sign-up" | "sign-in">("sign-up");
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  const expired = () => {
    const i = inv();
    return !!i && (i.status === "pending" ? i.expiresAt < Date.now() : false);
  };
  const emailMatches = () =>
    !!session() &&
    session()!.email.toLowerCase() === (inv()?.email ?? "").toLowerCase();

  async function accept() {
    const i = inv();
    if (!i) return;
    setBusy(true);
    setError("");
    const res = await authClient.organization.acceptInvitation({
      invitationId: i.id,
    });
    if (res.error) {
      setBusy(false);
      setError(res.error.message ?? "Could not accept the invitation");
      return;
    }
    try {
      await claimInvitationGrants(i.id);
    } catch {
      // grants are guest-only scope; a failed claim shouldn't strand the accept
    }
    await authClient.organization.setActive({ organizationId: i.organizationId });
    setBusy(false);
    navigate("/", { replace: true });
  }

  async function authenticate(e: SubmitEvent) {
    e.preventDefault();
    const i = inv();
    if (!i) return;
    const form = e.currentTarget as HTMLFormElement;
    const password = (form.elements.namedItem("password") as HTMLInputElement).value;
    setBusy(true);
    setError("");
    const res =
      mode() === "sign-up"
        ? await authClient.signUp.email({
            name: (form.elements.namedItem("name") as HTMLInputElement).value.trim(),
            email: i.email,
            password,
          })
        : await authClient.signIn.email({ email: i.email, password });
    setBusy(false);
    if (res.error) {
      setError(res.error.message ?? "Authentication failed");
      return;
    }
    await refetchSession();
    await accept();
  }

  async function switchAccount() {
    await authClient.signOut();
    await refetchSession();
  }

  return (
    <div class="p-1 h-screen bg-[#fffefe]">
      <div class="rounded-lg w-full h-full border border-[#eceaea] flex items-center justify-center">
        <div class="w-[380px] max-w-[90vw]">
          <div class="mb-6 text-center">
            <span class="text-sm font-semibold tracking-tight text-neutral-800">cruio</span>
            <p class="mt-1 text-xs text-neutral-400">creative pipeline</p>
          </div>

          <Switch>
            <Match when={inv.loading || session.loading}>
              <p class="text-center text-xs text-neutral-400">Loading invitation…</p>
            </Match>

            <Match when={!inv()}>
              <div class="p-5 border border-neutral-200 rounded-lg bg-white text-center">
                <Icon icon="iconoir:warning-triangle" width="24" class="text-neutral-300" />
                <p class="mt-2 text-sm font-medium text-neutral-700">Invitation not found</p>
                <p class="mt-1 text-xs text-neutral-400">
                  The link may be wrong, or the invitation was withdrawn.
                </p>
              </div>
            </Match>

            <Match when={inv()!.status !== "pending" || expired()}>
              <div class="p-5 border border-neutral-200 rounded-lg bg-white text-center">
                <Icon icon="iconoir:clock" width="24" class="text-neutral-300" />
                <p class="mt-2 text-sm font-medium text-neutral-700">
                  {inv()!.status === "accepted"
                    ? "Invitation already accepted"
                    : expired()
                      ? "Invitation expired"
                      : "Invitation no longer valid"}
                </p>
                <p class="mt-1 text-xs text-neutral-400">
                  Ask {inv()!.inviterName} to send a fresh invite link.
                </p>
              </div>
            </Match>

            <Match when={inv()}>
              {i => (
                <div class="p-5 border border-neutral-200 rounded-lg bg-white flex flex-col gap-3">
                  <div>
                    <h1 class="text-sm font-semibold text-neutral-800">
                      Join {i().organizationName}
                    </h1>
                    <p class="mt-1 text-xs text-neutral-400 leading-relaxed">
                      {i().inviterName} invited <span class="text-neutral-600">{i().email}</span>{" "}
                      as <span class="text-neutral-600">{i().role}</span>
                      {i().role === "guest" ? " (client reviewer)" : ""}.
                    </p>
                  </div>

                  <Switch>
                    {/* signed in with the right account */}
                    <Match when={emailMatches()}>
                      <Show when={error()}>
                        <p class="text-xs text-rose-600">{error()}</p>
                      </Show>
                      <button
                        disabled={busy()}
                        class="flex items-center justify-center gap-1 text-xs bg-neutral-900 text-white rounded px-3 py-2 hover:bg-neutral-700 cursor-pointer disabled:opacity-50"
                        onClick={() => void accept()}
                      >
                        <Show when={busy()} fallback={<>Accept invitation</>}>
                          <Icon icon="iconoir:refresh" width="12" class="animate-spin" /> Joining…
                        </Show>
                      </button>
                    </Match>

                    {/* signed in with a different account */}
                    <Match when={session()}>
                      <p class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                        You're signed in as {session()!.email}, but this invite is for{" "}
                        {i().email}.
                      </p>
                      <button
                        class="text-xs text-neutral-600 border border-neutral-200 rounded px-3 py-2 hover:bg-neutral-50 cursor-pointer"
                        onClick={() => void switchAccount()}
                      >
                        Sign out and continue as {i().email}
                      </button>
                    </Match>

                    {/* signed out: inline auth with the invited email locked */}
                    <Match when={true}>
                      <form onSubmit={authenticate} class="flex flex-col gap-3">
                        <Show when={mode() === "sign-up"}>
                          <label class="text-xs text-neutral-500">
                            Name
                            <input
                              name="name"
                              required
                              class="mt-1 w-full text-sm border border-neutral-200 rounded px-2 py-1.5 outline-none focus:border-sky-400"
                              placeholder="Your name"
                              ref={el => queueMicrotask(() => el.focus())}
                            />
                          </label>
                        </Show>
                        <label class="text-xs text-neutral-500">
                          Email
                          <input
                            value={i().email}
                            disabled
                            class="mt-1 w-full text-sm border border-neutral-200 rounded px-2 py-1.5 bg-neutral-50 text-neutral-400"
                          />
                          <span class="block mt-0.5 text-[10px] text-neutral-400">
                            Invites are tied to this email address.
                          </span>
                        </label>
                        <label class="text-xs text-neutral-500">
                          Password
                          <input
                            name="password"
                            type="password"
                            required
                            minlength={mode() === "sign-up" ? 8 : undefined}
                            autocomplete={mode() === "sign-up" ? "new-password" : "current-password"}
                            class="mt-1 w-full text-sm border border-neutral-200 rounded px-2 py-1.5 outline-none focus:border-sky-400"
                          />
                        </label>
                        <Show when={error()}>
                          <p class="text-xs text-rose-600">{error()}</p>
                        </Show>
                        <button
                          type="submit"
                          disabled={busy()}
                          class="flex items-center justify-center gap-1 text-xs bg-neutral-900 text-white rounded px-3 py-2 hover:bg-neutral-700 cursor-pointer disabled:opacity-50"
                        >
                          <Show when={busy()} fallback={<>{mode() === "sign-up" ? "Create account & join" : "Sign in & join"}</>}>
                            <Icon icon="iconoir:refresh" width="12" class="animate-spin" /> Joining…
                          </Show>
                        </button>
                        <button
                          type="button"
                          class="text-[11px] text-neutral-400 hover:text-neutral-600 cursor-pointer"
                          onClick={() => {
                            setMode(m => (m === "sign-up" ? "sign-in" : "sign-up"));
                            setError("");
                          }}
                        >
                          {mode() === "sign-up"
                            ? "Already have an account? Sign in"
                            : "New here? Create an account"}
                        </button>
                      </form>
                    </Match>
                  </Switch>
                </div>
              )}
            </Match>
          </Switch>
        </div>
      </div>
    </div>
  );
}
