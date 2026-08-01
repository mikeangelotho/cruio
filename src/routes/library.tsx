import { For, Show, createEffect, createMemo, createResource, createSignal, on, onCleanup, onMount } from "solid-js";
import { createAsync, useNavigate, useSearchParams } from "@solidjs/router";
import { Icon } from "@iconify-icon/solid";
import { useViewerRole } from "../lib/viewer";
import { AppNav } from "../components/AppNav";
import { AppFooter } from "../components/AppFooter";
import { useScope } from "../components/ScopeProvider";
import { FileCard } from "../components/FileCard";
import { ContextMenu, type MenuState } from "../components/ContextMenu";
import { EntityAvatar } from "../components/Avatar";
import {
  createFolder,
  deleteFile,
  deleteFolder,
  listLibrary,
  moveFile,
  renameFile,
  renameFolder,
} from "../lib/library-api";
import { myOrgsQuery, requireUserQuery } from "../lib/org-api";
import { fileUrl, type LibraryFile, type LibraryFolder } from "../lib/types";

export const route = {
  preload: () => {
    void requireUserQuery();
    void myOrgsQuery();
  },
};

export default function LibraryPage() {
  const navigate = useNavigate();
  const user = createAsync(() => requireUserQuery());
  const orgs = createAsync(() => myOrgsQuery());
  const scope = useScope();
  const [searchParams] = useSearchParams();

  const [listing, { refetch }] = createResource(
    () => ({ org: user()?.activeOrganizationId, entity: scope.entity()?.id ?? null }),
    ({ entity }) => listLibrary(entity),
  );

  const [selectedFolder, setSelectedFolder] = createSignal<string | null>(null);
  const [ctxMenu, setCtxMenu] = createSignal<MenuState | null>(null);
  const [addingFolder, setAddingFolder] = createSignal(false);
  const [error, setError] = createSignal("");
  const [dragOver, setDragOver] = createSignal(false);
  const [uploading, setUploading] = createSignal(0);
  const [highlightFileId, setHighlightFileId] = createSignal<string | null>(null);

  // arriving from a search result: select the folder and flash the file. The
  // fade-out timer only starts once the file has actually loaded — listing()
  // resolves over the network, so a fixed timeout from mount could expire
  // before the card (and the ring highlight) ever renders.
  createEffect(on(
    () => [searchParams.folder, searchParams.file] as const,
    ([folder, file]) => {
      const folderId = Array.isArray(folder) ? folder[0] : folder;
      const fileId = Array.isArray(file) ? file[0] : file;
      if (folderId) setSelectedFolder(folderId);
      if (fileId) setHighlightFileId(fileId);
    },
  ));
  createEffect(on(
    () => {
      const id = highlightFileId();
      return id && (listing()?.files ?? []).some(f => f.id === id) ? id : null;
    },
    id => {
      if (!id) return;
      const t = setTimeout(() => setHighlightFileId(null), 2500);
      onCleanup(() => clearTimeout(t));
    },
  ));

  const { myRole, isAdmin } = useViewerRole(user, orgs);
  const canUpload = () => myRole() !== undefined && myRole() !== "guest";

  const workspaceFolders = () => (listing()?.folders ?? []).filter(f => !f.projectId);
  const projectFolders = () => (listing()?.folders ?? []).filter(f => f.projectId);
  const currentFolder = createMemo(() =>
    (listing()?.folders ?? []).find(f => f.id === selectedFolder()),
  );
  const visibleFiles = createMemo(() => {
    const files = listing()?.files ?? [];
    const sel = selectedFolder();
    return sel ? files.filter(f => f.folderId === sel) : files;
  });

  async function run(action: () => Promise<unknown>) {
    setError("");
    try {
      await action();
      await refetch();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
      await refetch();
    }
  }

  async function uploadFiles(files: FileList | File[], folderId: string) {
    setError("");
    setUploading(u => u + files.length);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.set("folderId", folderId);
        form.set("file", file);
        const res = await fetch("/api/library/upload", { method: "POST", body: form });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `Upload failed (${res.status})`);
        }
      }
      await refetch();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setUploading(u => Math.max(0, u - files.length));
    }
  }

  function uploadTargetId(): string | null {
    const folder = currentFolder();
    return folder ? folder.id : null;
  }

  function pickAndUpload() {
    const target = uploadTargetId();
    if (!target) {
      setError("Select a folder to upload into");
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.onchange = () => {
      if (input.files?.length) void uploadFiles(input.files, target);
    };
    input.click();
  }

  // u = upload (unless typing somewhere) — same convention as N for "new"
  // elsewhere; pickAndUpload() itself handles the no-folder-selected case.
  onMount(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const typing =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;
      if (typing) return;
      if (e.key === "u" && !e.metaKey && !e.ctrlKey && !e.altKey && canUpload()) {
        e.preventDefault();
        pickAndUpload();
      }
    }
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  function openFolderMenu(f: LibraryFolder, x: number, y: number) {
    if (!isAdmin() || f.projectId) return;
    setCtxMenu({
      x,
      y,
      entries: [
        {
          label: "Rename folder",
          icon: "iconoir:edit-pencil",
          run: () => {
            const name = window.prompt("Folder name", f.name)?.trim();
            if (name && name !== f.name) void run(() => renameFolder(f.id, name));
          },
        },
        { separator: true } as const,
        {
          label: "Delete folder",
          icon: "iconoir:trash",
          danger: true,
          run: () => {
            if (!window.confirm(`Delete ${f.name}? The folder must be empty.`)) return;
            if (selectedFolder() === f.id) setSelectedFolder(null);
            void run(() => deleteFolder(f.id));
          },
        },
      ],
    });
  }

  function openFileMenu(file: LibraryFile, x: number, y: number) {
    const isMirror = !!file.versionId;
    const mirrorFolder = (listing()?.folders ?? []).find(f => f.id === file.folderId);
    const moveTargets = (listing()?.folders ?? []).filter(f => f.id !== file.folderId);
    setCtxMenu({
      x,
      y,
      entries: [
        ...(isMirror && mirrorFolder?.projectId
          ? [
              {
                label: "Open on canvas",
                icon: "iconoir:frame",
                hint: "↵",
                run: () =>
                  navigate(`/p/${mirrorFolder.projectId}/d/${file.deliverableId}`),
              },
            ]
          : []),
        {
          label: "Open file",
          icon: "iconoir:open-in-window",
          run: () => window.open(fileUrl(file.fileName), "_blank"),
        },
        ...(!isMirror && canUpload()
          ? [
              { separator: true } as const,
              {
                label: "Rename",
                icon: "iconoir:edit-pencil",
                run: () => {
                  const name = window.prompt("File name", file.name)?.trim();
                  if (name && name !== file.name) void run(() => renameFile(file.id, name));
                },
              },
              ...moveTargets.slice(0, 8).map(target => ({
                label: `Move to ${target.name}`,
                icon: "iconoir:folder-move" as string,
                run: () => void run(() => moveFile(file.id, target.id)),
              })),
              { separator: true } as const,
              {
                label: "Delete file",
                icon: "iconoir:trash",
                danger: true,
                run: () => {
                  if (!window.confirm(`Delete ${file.name}?`)) return;
                  void run(() => deleteFile(file.id));
                },
              },
            ]
          : []),
      ],
    });
  }

  function onFileClick(file: LibraryFile) {
    const folder = (listing()?.folders ?? []).find(f => f.id === file.folderId);
    if (file.versionId && folder?.projectId) {
      navigate(`/p/${folder.projectId}/d/${file.deliverableId}`);
    } else {
      window.open(fileUrl(file.fileName), "_blank");
    }
  }

  async function addFolder(e: SubmitEvent) {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const name = (form.elements.namedItem("name") as HTMLInputElement).value.trim();
    if (!name) return;
    setAddingFolder(false);
    await run(() => createFolder(name));
  }

  const folderRow = (f: LibraryFolder, icon: string) => (
    <button
      class="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left text-xs cursor-pointer"
      classList={{
        "bg-neutral-200/70 text-neutral-800 font-medium": selectedFolder() === f.id,
        "text-neutral-600 hover:bg-neutral-200/40": selectedFolder() !== f.id,
      }}
      onClick={() => setSelectedFolder(selectedFolder() === f.id ? null : f.id)}
      onContextMenu={e => {
        e.preventDefault();
        openFolderMenu(f, e.clientX, e.clientY);
      }}
    >
      <Icon icon={icon} width="13" class="text-neutral-400 shrink-0" />
      <span class="flex-1 truncate">{f.name}</span>
      <Show when={!scope.entity() && f.entityName}>
        <EntityAvatar name={f.entityName!} size={13} />
      </Show>
      <span class="text-[10px] text-neutral-400">
        {(listing()?.files ?? []).filter(x => x.folderId === f.id).length}
      </span>
    </button>
  );

  /** entity name of the folder a file lives in — attribution under "All" scope */
  const fileEntityName = (file: LibraryFile) =>
    (listing()?.folders ?? []).find(f => f.id === file.folderId)?.entityName ?? null;

  return (
    <div class="p-1 h-screen bg-canvas">
      <div class="rounded-lg overflow-clip w-full flex flex-col h-full border border-line">
        <AppNav onOrgSwitch={() => void refetch()} />

        <div class="flex-1 flex min-h-0">
          {/* folder rail */}
          <aside class="w-56 shrink-0 border-r border-hairline bg-panel p-3 overflow-y-auto">
            <button
              class="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left text-xs cursor-pointer mb-2"
              classList={{
                "bg-neutral-200/70 text-neutral-800 font-medium": selectedFolder() === null,
                "text-neutral-600 hover:bg-neutral-200/40": selectedFolder() !== null,
              }}
              onClick={() => setSelectedFolder(null)}
            >
              <Icon icon="iconoir:media-image-folder" width="13" class="text-neutral-400" />
              All files
            </button>

            <div class="flex items-center justify-between px-2.5 pt-2 pb-1">
              <span class="text-[10px] uppercase tracking-wide text-neutral-400">Workspace</span>
              <Show when={isAdmin()}>
                <button
                  class="text-neutral-400 hover:text-neutral-700 cursor-pointer"
                  title="New folder"
                  onClick={() => setAddingFolder(a => !a)}
                >
                  <Icon icon="iconoir:plus" width="12" />
                </button>
              </Show>
            </div>
            <Show when={addingFolder()}>
              <form onSubmit={addFolder} class="px-2 pb-1">
                <input
                  name="name"
                  required
                  placeholder="Folder name"
                  class="w-full text-xs border border-neutral-200 rounded px-2 py-1 outline-none focus:border-sky-400 bg-panel"
                  ref={el => queueMicrotask(() => el.focus())}
                  onKeyDown={e => {
                    if (e.key === "Escape") setAddingFolder(false);
                  }}
                />
              </form>
            </Show>
            <For each={workspaceFolders()}>{f => folderRow(f, "iconoir:folder")}</For>
            <Show when={workspaceFolders().length === 0 && !addingFolder()}>
              <p class="px-2.5 py-1 text-[10px] text-neutral-400">No workspace folders yet.</p>
            </Show>

            <div class="px-2.5 pt-3 pb-1 flex items-center gap-1.5">
              <span class="text-[10px] uppercase tracking-wide text-neutral-400">Projects</span>
              <Show when={scope.entity()}>
                <EntityAvatar name={scope.entity()!.name} size={12} />
              </Show>
            </div>
            <For each={projectFolders()}>{f => folderRow(f, "iconoir:frame")}</For>
            <Show when={projectFolders().length === 0}>
              <p class="px-2.5 py-1 text-[10px] text-neutral-400">
                {scope.entity()
                  ? "No projects for this entity."
                  : "Project folders appear when projects are created."}
              </p>
            </Show>
          </aside>

          {/* file grid */}
          <main
            class="flex-1 overflow-y-auto p-6"
            classList={{ "bg-accent-sky/40": dragOver() }}
            onDragOver={e => {
              if (!canUpload() || !uploadTargetId()) return;
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => {
              setDragOver(false);
              const target = uploadTargetId();
              if (!canUpload() || !target) return;
              e.preventDefault();
              if (e.dataTransfer?.files.length) void uploadFiles(e.dataTransfer.files, target);
            }}
          >
            <div class="flex items-center justify-between mb-4">
              <div class="flex items-center gap-3">
                <EntityAvatar name={scope.entity()?.name || "•"} size={32} />
                <h1 class="text-lg font-semibold text-neutral-800">
                  {currentFolder()?.name ?? "Library"}
                </h1>
                <Show when={uploading() > 0}>
                  <span class="text-[11px] text-neutral-400 animate-pulse">
                    uploading {uploading()}…
                  </span>
                </Show>
              </div>
              <Show when={canUpload()}>
                <button
                  class="flex items-center gap-1 text-xs bg-brand text-on-brand rounded-md px-3 py-1.5 hover:bg-neutral-700 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  disabled={!uploadTargetId()}
                  title={uploadTargetId() ? "Upload files (U)" : "Select a folder to upload into"}
                  onClick={pickAndUpload}
                >
                  <Icon icon="iconoir:upload" width="14" /> Upload
                  <span class="text-[10px] text-neutral-400 bg-neutral-800 rounded px-1 ml-1">U</span>
                </button>
              </Show>
            </div>

            <Show when={error()}>
              <p class="mb-4 text-xs text-on-accent-rose bg-accent-rose border border-accent-rose-line rounded px-3 py-2">
                {error()}
              </p>
            </Show>

            <Show
              when={visibleFiles().length > 0}
              fallback={
                <Show when={!listing.loading}>
                  <div class="text-center py-20 text-neutral-400">
                    <Icon icon="iconoir:media-image-folder" width="36" />
                    <p class="mt-3 text-sm text-neutral-500 font-medium">
                      {currentFolder() ? "This folder is empty" : "No files yet"}
                    </p>
                    <p class="mt-1 text-xs">
                      {canUpload()
                        ? currentFolder()
                          ? "Drop files here or use Upload."
                          : "Select a folder, then drop files or use Upload."
                        : "Files shared with you will appear here."}
                    </p>
                  </div>
                </Show>
              }
            >
              <div class="grid gap-3 grid-cols-[repeat(auto-fill,minmax(110px,140px))]">
                <For each={visibleFiles()}>
                  {file => (
                    <FileCard
                      file={file}
                      entityName={scope.entity() ? null : fileEntityName(file)}
                      onClick={() => onFileClick(file)}
                      onContextMenu={e => openFileMenu(file, e.clientX, e.clientY)}
                      highlighted={highlightFileId() === file.id}
                    />
                  )}
                </For>
              </div>
            </Show>
          </main>
        </div>

        <AppFooter
          start={
            <span class="flex items-center gap-1.5 text-neutral-500 truncate">
              <span class="font-medium">
                {listing()?.files.length ?? 0} file{(listing()?.files.length ?? 0) === 1 ? "" : "s"}
              </span>
              <span class="text-neutral-400">
                · {listing()?.folders.length ?? 0} folder
                {(listing()?.folders.length ?? 0) === 1 ? "" : "s"}
              </span>
            </span>
          }
        />
      </div>
      <ContextMenu state={ctxMenu()} onClose={() => setCtxMenu(null)} />
    </div>
  );
}
