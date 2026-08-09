import { For, Show, createEffect, createMemo, createResource, createSignal, on, onCleanup, onMount } from "solid-js";
import { createAsync, useNavigate, useSearchParams } from "@solidjs/router";
import { Icon } from "@iconify-icon/solid";
import { useViewerRole } from "../lib/viewer";
import { onAiInvalidate } from "../lib/ai/invalidate";
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
import { downloadFile, downloadZip } from "../lib/download";
import { confirm, promptText } from "../lib/confirm";
import { getPref, setPref } from "../lib/prefs";
import { pushToast, setToastRaised } from "../lib/toast";
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
  onAiInvalidate(() => void refetch());

  const [selectedFolder, setSelectedFolder] = createSignal<string | null>(null);
  const [ctxMenu, setCtxMenu] = createSignal<MenuState | null>(null);
  const [addingFolder, setAddingFolder] = createSignal(false);
  const [error, setError] = createSignal("");
  const [dragOver, setDragOver] = createSignal(false);
  const [uploading, setUploading] = createSignal(0);
  const [highlightFileId, setHighlightFileId] = createSignal<string | null>(null);
  const [view, setView] = createSignal<"grid" | "list">(
    getPref("cruio_library_view", "grid") as "grid" | "list",
  );
  createEffect(() => setPref("cruio_library_view", view()));
  const [selected, setSelected] = createSignal<Set<string>>(new Set());
  // anchor for shift-range selection; drag set for drag-to-folder.
  const [lastSelectedId, setLastSelectedId] = createSignal<string | null>(null);
  const [draggingIds, setDraggingIds] = createSignal<Set<string>>(new Set());
  const [dragFolder, setDragFolder] = createSignal<string | null>(null);

  function toggleSelect(id: string) {
    setSelected(s => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
    setLastSelectedId(id);
  }
  const clearSelection = () => setSelected(new Set<string>());
  const selectedFiles = () => (listing()?.files ?? []).filter(f => selected().has(f.id));
  // Canvas mirrors (versionId set) are managed from the board — exclude from
  // library-side move/delete so those stay a canvas-only concern.
  const movableSelected = () => selectedFiles().filter(f => !f.versionId);

  // Unified selection, matching the projects/canvas model: plain click selects
  // one (via a short timer so a double-click can open instead), shift = range,
  // Cmd/Ctrl or the checkbox = toggle multi.
  let clickTimer: ReturnType<typeof setTimeout> | undefined;
  function selectOne(id: string) {
    setSelected(new Set([id]));
    setLastSelectedId(id);
  }
  function selectRangeTo(id: string) {
    const files = visibleFiles();
    const a = files.findIndex(f => f.id === lastSelectedId());
    const b = files.findIndex(f => f.id === id);
    if (a < 0 || b < 0) return selectOne(id);
    const [lo, hi] = a < b ? [a, b] : [b, a];
    setSelected(new Set(files.slice(lo, hi + 1).map(f => f.id)));
  }
  function onFileSingleClick(file: LibraryFile, e: MouseEvent) {
    if (e.shiftKey) {
      clearTimeout(clickTimer);
      return selectRangeTo(file.id);
    }
    if (e.metaKey || e.ctrlKey) {
      clearTimeout(clickTimer);
      return toggleSelect(file.id);
    }
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => selectOne(file.id), 200);
  }
  function onFileDblClick(file: LibraryFile) {
    clearTimeout(clickTimer);
    openFile(file);
  }

  // Lift toasts above the bottom bulk bar while a selection is active.
  createEffect(() => setToastRaised(selected().size > 0));
  onCleanup(() => setToastRaised(false));

  function startFileDrag(file: LibraryFile, e: DragEvent) {
    const ids = selected().has(file.id) ? new Set(selected()) : new Set([file.id]);
    setDraggingIds(ids);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  }
  async function dropOnFolder(folderId: string) {
    const ids = draggingIds();
    setDraggingIds(new Set());
    setDragFolder(null);
    const files = (listing()?.files ?? []).filter(
      f => ids.has(f.id) && !f.versionId && f.folderId !== folderId,
    );
    if (!files.length) return;
    await run(async () => {
      for (const f of files) await moveFile(f.id, folderId);
    });
    clearSelection();
    pushToast(`Moved ${files.length} file${files.length === 1 ? "" : "s"}`);
  }

  function openMoveMenu(x: number, y: number) {
    const movable = movableSelected();
    if (!movable.length) {
      setError("Canvas files are managed from the board — select uploaded files to move.");
      return;
    }
    const folders = (listing()?.folders ?? []).filter(f => f.id !== selectedFolder());
    setCtxMenu({
      x,
      y,
      entries: [
        ...folders.map(f => ({
          label: `Move to ${f.name}`,
          icon: "iconoir:folder",
          run: () => void moveSelectedTo(f.id),
        })),
        ...(folders.length ? [{ separator: true } as const] : []),
        {
          label: "New folder…",
          icon: "iconoir:folder-plus",
          run: () => void moveToNewFolder(),
        },
      ],
    });
  }
  async function moveSelectedTo(folderId: string) {
    const movable = movableSelected();
    await run(async () => {
      for (const f of movable) await moveFile(f.id, folderId);
    });
    clearSelection();
    pushToast(`Moved ${movable.length} file${movable.length === 1 ? "" : "s"}`);
  }
  async function moveToNewFolder() {
    const name = (await promptText({
      title: "New folder",
      label: "Folder name",
      confirmLabel: "Create & move",
    }))?.trim();
    if (!name) return;
    const movable = movableSelected();
    await run(async () => {
      const folder = await createFolder(name);
      for (const f of movable) await moveFile(f.id, folder.id);
      setSelectedFolder(folder.id);
    });
    clearSelection();
    pushToast(`Moved ${movable.length} file${movable.length === 1 ? "" : "s"} to ${name}`);
  }
  async function deleteSelected() {
    const movable = movableSelected();
    if (!movable.length) {
      setError("Canvas files are deleted from the board, not the library.");
      return;
    }
    if (
      !(await confirm({
        title: `Delete ${movable.length} file${movable.length === 1 ? "" : "s"}?`,
        confirmLabel: "Delete",
        danger: true,
      }))
    )
      return;
    await run(async () => {
      for (const f of movable) await deleteFile(f.id);
    });
    clearSelection();
    pushToast(`Deleted ${movable.length} file${movable.length === 1 ? "" : "s"}`);
  }
  function downloadSelected() {
    void downloadZip(selectedFiles().map(f => ({ name: f.fileName, displayName: f.name })));
  }

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
          run: async () => {
            const name = (await promptText({
              title: "Rename folder",
              label: "Folder name",
              initial: f.name,
            }))?.trim();
            if (name && name !== f.name) void run(() => renameFolder(f.id, name));
          },
        },
        { separator: true } as const,
        {
          label: "Delete folder",
          icon: "iconoir:trash",
          danger: true,
          run: async () => {
            if (
              !(await confirm({
                title: "Delete folder",
                description: `Delete “${f.name}”? The folder must be empty.`,
                confirmLabel: "Delete",
                danger: true,
              }))
            )
              return;
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
        {
          label: "Download",
          icon: "iconoir:download",
          run: () => downloadFile(file.fileName),
        },
        ...(!isMirror && canUpload()
          ? [
              { separator: true } as const,
              {
                label: "Rename",
                icon: "iconoir:edit-pencil",
                run: async () => {
                  const name = (await promptText({
                    title: "Rename file",
                    label: "File name",
                    initial: file.name,
                  }))?.trim();
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
                run: async () => {
                  if (
                    !(await confirm({
                      title: "Delete file",
                      description: `Delete “${file.name}”?`,
                      confirmLabel: "Delete",
                      danger: true,
                    }))
                  )
                    return;
                  void run(() => deleteFile(file.id));
                },
              },
            ]
          : []),
      ],
    });
  }

  function openFile(file: LibraryFile) {
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
        "bg-neutral-200/70 text-neutral-800 font-medium": selectedFolder() === f.id && dragFolder() !== f.id,
        "text-neutral-600 hover:bg-neutral-200/40": selectedFolder() !== f.id && dragFolder() !== f.id,
        "bg-accent-sky text-on-accent-sky ring-1 ring-accent-sky-line": dragFolder() === f.id,
      }}
      onClick={() => {
        setSelectedFolder(selectedFolder() === f.id ? null : f.id);
        setRailOpen(false);
      }}
      onContextMenu={e => {
        e.preventDefault();
        openFolderMenu(f, e.clientX, e.clientY);
      }}
      onDragOver={e => {
        if (draggingIds().size === 0) return;
        e.preventDefault();
        setDragFolder(f.id);
      }}
      onDragLeave={() => setDragFolder(d => (d === f.id ? null : d))}
      onDrop={e => {
        e.preventDefault();
        void dropOnFolder(f.id);
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

  // Folder rail is a slide-in drawer on mobile; this drives it (ignored at sm+).
  const [railOpen, setRailOpen] = createSignal(false);

  return (
    <div class="p-1 h-full bg-canvas">
      <div class="rounded-lg overflow-clip w-full flex flex-col h-full border border-line">
        <AppNav onOrgSwitch={() => void refetch()} />

        <div class="flex-1 flex min-h-0 relative">
          {/* mobile scrim behind the folder drawer */}
          <Show when={railOpen()}>
            <div
              class="absolute inset-0 z-20 bg-scrim sm:hidden"
              onClick={() => setRailOpen(false)}
            />
          </Show>
          {/* folder rail — a slide-in drawer on mobile, a static column from sm up */}
          <aside
            class="w-56 shrink-0 border-r border-hairline bg-panel p-3 overflow-y-auto absolute inset-y-0 left-0 z-30 shadow-xl sm:static sm:z-auto sm:shadow-none transition-transform"
            classList={{ "-translate-x-full sm:translate-x-0": !railOpen() }}
          >
            <button
              class="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left text-xs cursor-pointer mb-2"
              classList={{
                "bg-neutral-200/70 text-neutral-800 font-medium": selectedFolder() === null,
                "text-neutral-600 hover:bg-neutral-200/40": selectedFolder() !== null,
              }}
              onClick={() => {
                setSelectedFolder(null);
                setRailOpen(false);
              }}
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
            class="flex-1 min-w-0 overflow-y-auto p-3 sm:p-6"
            classList={{ "bg-accent-sky/40": dragOver() }}
            onClick={e => {
              // click on empty space (not a file card) clears the selection
              if (selected().size && !(e.target as HTMLElement).closest("[data-file-card]"))
                clearSelection();
            }}
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
            <div class="flex items-center justify-between gap-2 flex-wrap mb-4">
              <div class="flex items-center gap-2 sm:gap-3 min-w-0">
                <button
                  class="sm:hidden shrink-0 p-1.5 rounded-md text-neutral-500 hover:bg-neutral-100 cursor-pointer"
                  title="Folders"
                  onClick={() => setRailOpen(true)}
                >
                  <Icon icon="iconoir:sidebar-collapse" width="18" />
                </button>
                <EntityAvatar name={scope.entity()?.name || "•"} size={32} />
                <h1 class="text-lg font-semibold text-neutral-800 truncate">
                  {currentFolder()?.name ?? "Library"}
                </h1>
                <Show when={uploading() > 0}>
                  <span class="text-[11px] text-neutral-400 animate-pulse">
                    uploading {uploading()}…
                  </span>
                </Show>
              </div>
              <div class="flex items-center gap-2">
                <div class="flex items-center bg-neutral-100 rounded-md p-0.5">
                  <For each={[
                    { value: "grid", label: "Grid", icon: "iconoir:view-grid" },
                    { value: "list", label: "List", icon: "iconoir:list" },
                  ] as const}>
                    {o => (
                      <button
                        class="flex items-center gap-1 text-[11px] rounded px-2 py-1 cursor-pointer"
                        classList={{
                          "bg-panel shadow-sm text-neutral-800": view() === o.value,
                          "text-neutral-500": view() !== o.value,
                        }}
                        title={`${o.label} view`}
                        onClick={() => setView(o.value)}
                      >
                        <Icon icon={o.icon} width="13" />
                      </button>
                    )}
                  </For>
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
              <Show
                when={view() === "grid"}
                fallback={
                  <div class="border border-neutral-200 rounded-lg bg-panel divide-y divide-neutral-100 overflow-hidden">
                    <For each={visibleFiles()}>
                      {file => (
                        <FileCard
                          file={file}
                          layout="list"
                          entityName={scope.entity() ? null : fileEntityName(file)}
                          onClick={e => onFileSingleClick(file, e)}
                          onDblClick={() => onFileDblClick(file)}
                          draggable={canUpload()}
                          onDragStart={e => startFileDrag(file, e)}
                          onContextMenu={e => openFileMenu(file, e.clientX, e.clientY)}
                          highlighted={highlightFileId() === file.id}
                          selected={selected().has(file.id)}
                          onToggleSelect={() => toggleSelect(file.id)}
                        />
                      )}
                    </For>
                  </div>
                }
              >
                <div class="grid gap-3 grid-cols-[repeat(auto-fill,minmax(110px,140px))]">
                  <For each={visibleFiles()}>
                    {file => (
                      <FileCard
                        file={file}
                        entityName={scope.entity() ? null : fileEntityName(file)}
                        onClick={e => onFileSingleClick(file, e)}
                        onDblClick={() => onFileDblClick(file)}
                        draggable={canUpload()}
                        onDragStart={e => startFileDrag(file, e)}
                        onContextMenu={e => openFileMenu(file, e.clientX, e.clientY)}
                        highlighted={highlightFileId() === file.id}
                        selected={selected().has(file.id)}
                        onToggleSelect={() => toggleSelect(file.id)}
                      />
                    )}
                  </For>
                </div>
              </Show>
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
      <Show when={selected().size > 0}>
        <div class="fixed bottom-16 sm:bottom-5 left-1/2 -translate-x-1/2 z-30 flex flex-wrap items-center justify-center gap-1.5 max-w-[95vw] bg-brand text-on-brand rounded-lg shadow-2xl px-3 py-2 text-xs">
          <span class="px-2 font-medium">{selected().size} selected</span>
          <button
            class="flex items-center gap-1 px-2 py-1 rounded hover:bg-panel/10 cursor-pointer"
            onClick={downloadSelected}
          >
            <Icon icon="iconoir:download" width="13" /> Download
          </button>
          <Show when={canUpload()}>
            <button
              class="flex items-center gap-1 px-2 py-1 rounded hover:bg-panel/10 cursor-pointer"
              title="Move selected files to a folder"
              onClick={e => {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                openMoveMenu(r.left, r.top - 8);
              }}
            >
              <Icon icon="iconoir:folder" width="13" /> Move to folder
            </button>
            <button
              class="flex items-center gap-1 px-2 py-1 rounded text-on-brand-danger hover:bg-panel/10 cursor-pointer"
              title="Delete selected files"
              onClick={() => void deleteSelected()}
            >
              <Icon icon="iconoir:trash" width="13" /> Delete
            </button>
          </Show>
          <button
            class="p-1 rounded hover:bg-panel/10 cursor-pointer"
            title="Clear selection"
            onClick={clearSelection}
          >
            <Icon icon="iconoir:xmark" width="13" />
          </button>
        </div>
      </Show>
    </div>
  );
}
