import { For, Show, Suspense, createMemo } from "solid-js";
import { createAsync, useParams } from "@solidjs/router";
import { Icon } from "@iconify-icon/solid";
import { getSharedDeliverable } from "../../lib/share-api";

/**
 * Public read-only share viewer — /s/<token>. No account or session required;
 * the loader validates the token server-side and returns only the shared
 * deliverable's name, status, and version images. Deliberately outside the app
 * chrome (no AppNav, no auth query) so it renders for anonymous visitors.
 */
export default function SharePage() {
  const params = useParams();
  const data = createAsync(() => getSharedDeliverable(params.token));
  const fileUrl = (fileName: string) => `/api/share/${params.token}/file/${fileName}`;
  const latest = createMemo(() => data()?.versions[0]);

  return (
    <div class="min-h-screen bg-canvas text-neutral-800 flex flex-col">
      <header class="h-12 px-4 flex items-center gap-2 border-b border-hairline bg-surface">
        <Icon icon="iconoir:media-image" width="16" class="text-neutral-400" />
        <span class="text-sm font-semibold">Cruio</span>
        <span class="text-[11px] text-neutral-400 ml-1">shared preview</span>
      </header>

      <main class="flex-1 flex flex-col items-center px-4 py-8">
        <Suspense
          fallback={<p class="text-sm text-neutral-400 mt-16">Loading…</p>}
        >
          <Show
            when={data()}
            fallback={
              <div class="mt-20 text-center">
                <Icon icon="iconoir:link-broken" width="32" class="text-neutral-300" />
                <h1 class="mt-3 text-lg font-semibold">Link unavailable</h1>
                <p class="mt-1 text-sm text-neutral-500 max-w-sm">
                  This share link is invalid, has been revoked, or has expired.
                </p>
              </div>
            }
          >
            {view => (
              <div class="w-full max-w-3xl">
                <div class="flex items-center gap-2 mb-4">
                  <h1 class="text-lg font-semibold truncate">{view().name}</h1>
                  <span class="text-[11px] text-neutral-500 bg-muted rounded px-2 py-0.5 capitalize">
                    {view().status.replace(/_/g, " ")}
                  </span>
                </div>
                <Show
                  when={latest()}
                  fallback={
                    <p class="text-sm text-neutral-400">No versions to preview yet.</p>
                  }
                >
                  <div class="rounded-lg border border-neutral-200 bg-panel overflow-hidden shadow-sm">
                    <img
                      src={fileUrl(latest()!.fileName)}
                      alt={view().name}
                      class="w-full h-auto max-h-[75vh] object-contain bg-neutral-50"
                    />
                  </div>
                  <Show when={view().versions.length > 1}>
                    <div class="mt-4">
                      <p class="text-[10px] uppercase tracking-wide text-neutral-400 mb-2">
                        Versions
                      </p>
                      <div class="flex gap-2 flex-wrap">
                        <For each={view().versions}>
                          {v => (
                            <a
                              href={fileUrl(v.fileName)}
                              target="_blank"
                              rel="noopener noreferrer"
                              class="w-20 h-20 rounded border border-neutral-200 overflow-hidden bg-neutral-50 hover:border-neutral-400"
                              title={`v${v.number}`}
                            >
                              <img
                                src={fileUrl(v.fileName)}
                                alt={`v${v.number}`}
                                class="w-full h-full object-cover"
                              />
                            </a>
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>
                </Show>
              </div>
            )}
          </Show>
        </Suspense>
      </main>
    </div>
  );
}
