import { For, Show, createResource, createSignal } from "solid-js";
import { createAsync, useNavigate } from "@solidjs/router";
import { Icon } from "@iconify-icon/solid";
import { authClient } from "../../lib/auth-client";
import { listProjects } from "../../lib/api";
import {
  cancelInvitation,
  grantInvitationProjects,
  listInvitations,
  listMembers,
  myOrgsQuery,
  removeMember,
  requireUserQuery,
  shareProject,
  unshareProject,
  updateMemberRole,
} from "../../lib/org-api";
import { useViewerRole } from "../../lib/viewer";
import { Avatar } from "../../components/Avatar";
import { SettingsNav } from "../../components/SettingsNav";
import { AppFooter } from "../../components/AppFooter";
import type { OrgRole } from "../../lib/types";

export const route = {
  preload: () => {
    void requireUserQuery();
    void myOrgsQuery();
  },
};

const ROLES: OrgRole[] = ["admin", "member", "guest"];

export default function MembersPage() {
  const navigate = useNavigate();
  const user = createAsync(() => requireUserQuery());
  const orgs = createAsync(() => myOrgsQuery());

  const orgId = () => user()?.activeOrganizationId ?? null;
  const { activeOrg, myRole, isAdmin } = useViewerRole(user, orgs);

  const [members, { refetch: refetchMembers }] = createResource(
    orgId,
    id => listMembers(id),
  );
  const [invitations, { refetch: refetchInvites }] = createResource(
    orgId,
    () => listInvitations(orgId()!),
  );
  const [projects] = createResource(orgId, () => listProjects());

  const [inviteRole, setInviteRole] = createSignal<OrgRole>("member");
  const [inviteProjects, setInviteProjects] = createSignal<string[]>([]);
  const [error, setError] = createSignal("");
  const [flash, setFlash] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [expandedGuest, setExpandedGuest] = createSignal<string | null>(null);

  let flashTimer: ReturnType<typeof setTimeout> | undefined;
  function showFlash(msg: string) {
    setFlash(msg);
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => setFlash(""), 3000);
  }

  async function invite(e: SubmitEvent) {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const email = (form.elements.namedItem("email") as HTMLInputElement).value.trim();
    const oid = orgId();
    if (!email || !oid) return;
    setBusy(true);
    setError("");
    const res = await authClient.organization.inviteMember({
      email,
      role: inviteRole() as "admin" | "member",
      organizationId: oid,
    });
    if (res.error || !res.data) {
      setBusy(false);
      setError(res.error?.message ?? "Could not create the invitation");
      return;
    }
    if (inviteRole() === "guest" && inviteProjects().length) {
      try {
        await grantInvitationProjects(res.data.id, inviteProjects());
      } catch (err) {
        setError(String(err));
      }
    }
    setBusy(false);
    form.reset();
    setInviteProjects([]);
    await refetchInvites();
    void copyLink(res.data.id, email);
  }

  async function copyLink(invitationId: string, email?: string) {
    const url = `${window.location.origin}/invite/${invitationId}`;
    try {
      await navigator.clipboard.writeText(url);
      showFlash(`Invite link copied${email ? ` — send it to ${email}` : ""}`);
    } catch {
      showFlash(url);
    }
  }

  async function changeRole(memberId: string, role: OrgRole) {
    setError("");
    try {
      await updateMemberRole(orgId()!, memberId, role);
      await refetchMembers();
    } catch (e) {
      setError(String(e));
      await refetchMembers();
    }
  }

  async function remove(memberId: string, name: string) {
    if (!window.confirm(`Remove ${name} from the studio?`)) return;
    setError("");
    try {
      await removeMember(orgId()!, memberId);
      await refetchMembers();
      showFlash(`${name} removed`);
    } catch (e) {
      setError(String(e));
    }
  }

  async function cancelInvite(id: string) {
    setError("");
    try {
      await cancelInvitation(id);
      await refetchInvites();
      showFlash("Invitation withdrawn");
    } catch (e) {
      setError(String(e));
    }
  }

  async function toggleShare(userId: string, projectId: string, shared: boolean) {
    setError("");
    try {
      if (shared) await unshareProject(projectId, userId);
      else await shareProject(projectId, userId);
      await refetchMembers();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div class="p-1 h-screen bg-[#fffefe]">
      <div class="rounded-lg overflow-clip w-full flex flex-col h-full border border-[#eceaea]">
        <SettingsNav
          title="Members"
          orgName={activeOrg()?.name}
          crossLink={{ href: "/settings/entities", label: "Entities", icon: "iconoir:building" }}
        />

        <main class="flex-1 overflow-y-auto p-8">
          <Show
            when={myRole() === undefined || isAdmin()}
            fallback={(() => {
              navigate("/", { replace: true });
              return null;
            })()}
          >
            <div class="max-w-2xl mx-auto space-y-8">
              <Show when={error()}>
                <p class="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded px-3 py-2">
                  {error()}
                </p>
              </Show>

              {/* invite form */}
              <section>
                <h2 class="text-sm font-semibold text-neutral-800 mb-3">Invite someone</h2>
                <form
                  onSubmit={invite}
                  class="p-4 border border-neutral-200 rounded-lg bg-white space-y-3"
                >
                  <div class="flex gap-3 items-end">
                    <label class="flex-1 text-xs text-neutral-500">
                      Email
                      <input
                        name="email"
                        type="email"
                        required
                        class="mt-1 w-full text-sm border border-neutral-200 rounded px-2 py-1.5 outline-none focus:border-sky-400"
                        placeholder="teammate@studio.com"
                      />
                    </label>
                    <label class="text-xs text-neutral-500">
                      Role
                      <select
                        class="mt-1 block text-sm border border-neutral-200 rounded px-2 py-1.5 outline-none focus:border-sky-400 bg-white"
                        onChange={e => setInviteRole(e.currentTarget.value as OrgRole)}
                      >
                        <For each={ROLES}>
                          {r => (
                            <option value={r} selected={inviteRole() === r}>
                              {r}
                            </option>
                          )}
                        </For>
                      </select>
                    </label>
                    <button
                      type="submit"
                      disabled={busy()}
                      class="text-xs bg-neutral-900 text-white rounded px-3 py-2 hover:bg-neutral-700 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Create invite link
                    </button>
                  </div>
                  <Show when={inviteRole() === "guest"}>
                    <div class="text-xs text-neutral-500">
                      <p class="mb-1.5">
                        Guests are external client reviewers — they only see the projects you
                        share:
                      </p>
                      <div class="flex flex-wrap gap-2">
                        <For each={projects() ?? []}>
                          {p => (
                            <label class="flex items-center gap-1.5 border border-neutral-200 rounded px-2 py-1 cursor-pointer hover:bg-neutral-50">
                              <input
                                type="checkbox"
                                checked={inviteProjects().includes(p.id)}
                                onChange={e =>
                                  setInviteProjects(list =>
                                    e.currentTarget.checked
                                      ? [...list, p.id]
                                      : list.filter(id => id !== p.id),
                                  )
                                }
                              />
                              {p.name}
                            </label>
                          )}
                        </For>
                        <Show when={(projects() ?? []).length === 0}>
                          <span class="text-neutral-400">No projects yet.</span>
                        </Show>
                      </div>
                    </div>
                  </Show>
                  <p class="text-[11px] text-neutral-400">
                    No email is sent — you'll get a link to copy. The invitee must sign in with
                    the invited email address.
                  </p>
                </form>
              </section>

              {/* pending invitations */}
              <Show when={(invitations() ?? []).length > 0}>
                <section>
                  <h2 class="text-sm font-semibold text-neutral-800 mb-3">Pending invitations</h2>
                  <div class="border border-neutral-200 rounded-lg bg-white divide-y divide-neutral-100">
                    <For each={invitations()}>
                      {i => (
                        <div class="px-4 py-2.5 flex items-center gap-3">
                          <Icon icon="iconoir:mail" width="14" class="text-neutral-300" />
                          <div class="flex-1 min-w-0">
                            <p class="text-xs text-neutral-700 truncate">{i.email}</p>
                            <p class="text-[10px] text-neutral-400">
                              {i.role}
                              <Show when={i.role === "guest" && i.projectIds.length > 0}>
                                <span>
                                  {" "}· {i.projectIds.length} project
                                  {i.projectIds.length === 1 ? "" : "s"}
                                </span>
                              </Show>
                              {" "}· expires {new Date(i.expiresAt).toLocaleDateString()}
                            </p>
                          </div>
                          <button
                            class="flex items-center gap-1 text-[11px] text-neutral-600 border border-neutral-200 rounded px-2 py-1 hover:bg-neutral-50 cursor-pointer"
                            onClick={() => void copyLink(i.id)}
                          >
                            <Icon icon="iconoir:copy" width="11" /> Copy link
                          </button>
                          <button
                            class="text-[11px] text-neutral-400 hover:text-rose-600 cursor-pointer p-1"
                            title="Withdraw invitation"
                            onClick={() => void cancelInvite(i.id)}
                          >
                            <Icon icon="iconoir:xmark" width="13" />
                          </button>
                        </div>
                      )}
                    </For>
                  </div>
                </section>
              </Show>

              {/* members */}
              <section>
                <h2 class="text-sm font-semibold text-neutral-800 mb-3">Members</h2>
                <div class="border border-neutral-200 rounded-lg bg-white divide-y divide-neutral-100">
                  <For each={members() ?? []}>
                    {m => {
                      const self = () => m.userId === user()?.userId;
                      return (
                        <div class="px-4 py-2.5">
                          <div class="flex items-center gap-3">
                            <Avatar name={m.name} size={26} />
                            <div class="flex-1 min-w-0">
                              <p class="text-xs font-medium text-neutral-800 truncate">
                                {m.name}
                                <Show when={self()}>
                                  <span class="ml-1 text-[10px] text-neutral-400 font-normal">
                                    (you)
                                  </span>
                                </Show>
                              </p>
                              <p class="text-[10px] text-neutral-400 truncate">{m.email}</p>
                            </div>
                            <Show when={m.role === "guest"}>
                              <button
                                class="text-[11px] text-neutral-500 hover:text-neutral-800 cursor-pointer"
                                onClick={() =>
                                  setExpandedGuest(g => (g === m.userId ? null : m.userId))
                                }
                              >
                                {m.sharedProjectIds.length} project
                                {m.sharedProjectIds.length === 1 ? "" : "s"} shared
                              </button>
                            </Show>
                            <Show
                              when={m.role !== "owner" && !self()}
                              fallback={
                                <span class="text-[11px] text-neutral-400 w-20 text-right">
                                  {m.role}
                                </span>
                              }
                            >
                              <select
                                class="text-[11px] border border-neutral-200 rounded px-1.5 py-1 bg-white outline-none focus:border-sky-400 cursor-pointer"
                                onChange={e =>
                                  void changeRole(m.memberId, e.currentTarget.value as OrgRole)
                                }
                              >
                                <For each={ROLES}>
                                  {r => (
                                    <option value={r} selected={m.role === r}>
                                      {r}
                                    </option>
                                  )}
                                </For>
                              </select>
                              <button
                                class="text-neutral-400 hover:text-rose-600 cursor-pointer p-1"
                                title={`Remove ${m.name}`}
                                onClick={() => void remove(m.memberId, m.name)}
                              >
                                <Icon icon="iconoir:trash" width="13" />
                              </button>
                            </Show>
                          </div>

                          {/* guest project shares */}
                          <Show when={m.role === "guest" && expandedGuest() === m.userId}>
                            <div class="mt-2 ml-9 flex flex-wrap gap-2">
                              <For each={projects() ?? []}>
                                {p => {
                                  const shared = () => m.sharedProjectIds.includes(p.id);
                                  return (
                                    <label class="flex items-center gap-1.5 text-[11px] text-neutral-600 border border-neutral-200 rounded px-2 py-1 cursor-pointer hover:bg-neutral-50">
                                      <input
                                        type="checkbox"
                                        checked={shared()}
                                        onChange={() =>
                                          void toggleShare(m.userId, p.id, shared())
                                        }
                                      />
                                      {p.name}
                                    </label>
                                  );
                                }}
                              </For>
                            </div>
                          </Show>
                        </div>
                      );
                    }}
                  </For>
                  <Show when={members.loading && !members()}>
                    <p class="px-4 py-3 text-xs text-neutral-400">Loading…</p>
                  </Show>
                </div>
              </section>
            </div>
          </Show>
        </main>

        <AppFooter>
          <Show when={flash()}>
            <span class="text-neutral-600 font-medium">{flash()}</span>
          </Show>
        </AppFooter>
      </div>
    </div>
  );
}
