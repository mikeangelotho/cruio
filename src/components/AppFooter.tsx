import { Show, type JSX } from "solid-js";
import { createAsync, revalidate, useNavigate } from "@solidjs/router";
import { Icon } from "@iconify-icon/solid";
import { myOrgsQuery, requireUserQuery, sessionQuery } from "../lib/org-api";
import { authClient } from "../lib/auth-client";
import { useViewerRole } from "../lib/viewer";
import { Avatar } from "./Avatar";
import { NavMenu } from "./NavMenu";

/**
 * The single app status bar, used on every screen (main pages and the
 * canvas alike). It always renders the user menu (sign out) on the left and
 * the brand mark centered; each screen fills the slots around them:
 *   - `start`: page-specific info shown left, next to the user menu
 *     (e.g. project counts, or the canvas's deliverable/status readout).
 *   - `children`: right-aligned slot (e.g. a flash message or keyboard hints).
 * The logo is absolutely centered so it stays put regardless of slot widths.
 */
export function AppFooter(props: { start?: JSX.Element; children?: JSX.Element }) {
  const navigate = useNavigate();
  const user = createAsync(() => requireUserQuery());
  const orgs = createAsync(() => myOrgsQuery());
  const { activeOrg, myRole } = useViewerRole(user, orgs);

  async function signOut() {
    await authClient.signOut();
    // clear every auth-derived query cache — otherwise the sign-in page's
    // sessionQuery stays "authed" and bounces straight back to the projects page
    await revalidate([sessionQuery.key, requireUserQuery.key, myOrgsQuery.key]);
    navigate("/sign-in", { replace: true });
  }

  return (
    <footer class="relative min-h-8 px-3 py-1 flex gap-3 items-center justify-between bg-[#f8f7f7] border-t border-[#f0eeee] text-[11px] text-neutral-400">
      <div class="flex items-center gap-2 min-w-0">
        <Show when={user()}>
          {u => (
            <NavMenu
              anchor="top"
              panelClass="w-52"
              trigger={({ toggle }) => (
                <button
                  class="flex items-center gap-1.5 cursor-pointer px-1 py-1 rounded-lg hover:bg-neutral-200/80"
                  onClick={toggle}
                >
                  <Avatar name={u().name} size={21} />
                </button>
              )}
            >
              {({ close }) => (
                <>
                  <div class="p-3 flex gap-3 items-center border-b border-neutral-100">
                    <Avatar name={u().name} size={32} />
                    <div class="min-w-0">
                      <p class="text-xs font-medium text-neutral-800 truncate">{u().name}</p>
                      <p class="text-[10px] text-neutral-400 truncate">{u().email}</p>
                      <Show when={myRole()}>
                        <p class="mt-0.5 text-[10px] text-neutral-400">
                          {myRole()} · {activeOrg()?.name}
                        </p>
                      </Show>
                    </div>
                  </div>
                  <div class="p-2">
                    <button
                      class="rounded-md w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-neutral-600 hover:bg-neutral-50 cursor-pointer"
                      onClick={() => {
                        close();
                        void signOut();
                      }}
                    >
                      <Icon icon="iconoir:log-out" width="13" /> Sign out
                    </button>
                  </div>
                </>
              )}
            </NavMenu>
          )}
        </Show>
        {props.start}
      </div>
      <a
        href="/"
        class="absolute left-1/2 -translate-x-1/2 opacity-20 hover:opacity-100 transition-opacity ease-in-out duration-150"
      >
        <img style="height: 16px;" src="/CRIO_Logo-2026.svg" />
      </a>
      <div class="flex items-center gap-2.5 shrink-0 justify-end">{props.children}</div>
    </footer>
  );
}
