import { For, Show, batch, createEffect, createMemo, createSignal, on, onCleanup, onMount, untrack } from "solid-js";
import { useNavigate, useParams, A } from "@solidjs/router";
import { Icon } from "@iconify-icon/solid";
import { createCamera } from "../lib/canvas/camera";
import { DotGrid } from "../lib/canvas/DotGrid";
import { CARD_W, boundsOf, cardRect, planeRect } from "../lib/canvas/geometry";
import { useProject, uploadVersion } from "../lib/store";
import { fileUrl } from "../lib/types";
import type { Rect } from "../lib/canvas/camera";
import type { Annotation, Decision, Deliverable, Version } from "../lib/types";
import { ContextMenu, type MenuEntry, type MenuState } from "./ContextMenu";
import { DeliverableCard, STATUS_META } from "./DeliverableCard";
import { HistoryPanel } from "./HistoryPanel";
import { ReviewPlane } from "./ReviewPlane";
import { ThreadSidebar } from "./ThreadSidebar";
import { StatusRail } from "./StatusRail";
import { CommandPalette } from "./CommandPalette";

export function ProjectCanvas() {
  const store = useProject();
  const params = useParams();
  const navigate = useNavigate();
  const camera = createCamera();

  let container!: HTMLDivElement;
  let fileInput!: HTMLInputElement;

  const [selectedAnnId, setSelectedAnnId] = createSignal<string | null>(null);
  const [versionOverride, setVersionOverride] = createSignal<string | null>(null);
  const [compare, setCompare] = createSignal(false);
  const [historyOpen, setHistoryOpen] = createSignal(false);
  const [sidebarOpen, setSidebarOpen] = createSignal(true);
  const [paletteOpen, setPaletteOpen] = createSignal(false);
  const [panning, setPanning] = createSignal(false);
  const [statusMsg, setStatusMsg] = createSignal("");
  const [pendingDecision, setPendingDecision] = createSignal<Decision | null>(null);
  const [ctxMenu, setCtxMenu] = createSignal<MenuState | null>(null);
  // per-card action hooks (inline rename) for the shared context menu
  const cardActions = new Map<string, { startRename: () => void }>();

  let statusTimer: ReturnType<typeof setTimeout> | undefined;
  function flash(msg: string) {
    setStatusMsg(msg);
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => setStatusMsg(""), 4000);
  }

  // ---- derived state -------------------------------------------------------

  const reviewId = () => params.deliverableId as string | undefined;
  const current = createMemo(() => (reviewId() ? store.byId(reviewId()!) : undefined));

  // role-adaptive gating (server enforces the same matrix on every call)
  const canCreate = () => store.can("deliverable", "create");
  const canEdit = () => store.can("deliverable", "update");
  const canUpload = () => store.can("version", "upload");
  const canDeleteVersion = () => store.can("version", "delete");
  const canDeleteDeliverable = () => store.can("deliverable", "delete");

  const currentVersion = createMemo<Version | undefined>(() => {
    const d = current();
    if (!d) return undefined;
    const override = versionOverride();
    return d.versions.find(v => v.id === override) ?? d.versions[d.versions.length - 1];
  });

  const versionAnnotations = createMemo<Annotation[]>(() => {
    const d = current();
    const v = currentVersion();
    if (!d || !v) return [];
    return d.annotations.filter(a => a.versionId === v.id);
  });

  const openThreadCount = () => versionAnnotations().filter(a => a.status === "open").length;

  /**
   * Compare mode: every version laid out in one row (ascending), scaled to the
   * current version's height, current one highlighted. Null when not comparing.
   */
  const compareLayout = createMemo<{ v: Version; rect: Rect; current: boolean }[] | null>(() => {
    const d = current();
    const cv = currentVersion();
    if (!d || !cv || !compare() || d.versions.length < 2) return null;
    const base = planeRect(d, cv);
    const list = [...d.versions].sort((a, b) => a.number - b.number);
    const GAP = 64;
    const widths = list.map(v =>
      v.width && v.height ? (base.h * v.width) / v.height : base.w,
    );
    const totalW = widths.reduce((a, b) => a + b, 0) + GAP * (list.length - 1);
    let x = base.x + base.w / 2 - totalW / 2;
    return list.map((v, i) => {
      const rect = { x, y: base.y, w: widths[i], h: base.h };
      x += widths[i] + GAP;
      return { v, rect, current: v.id === cv.id };
    });
  });

  const plane = createMemo(() => {
    const d = current();
    if (!d) return null;
    const cl = compareLayout();
    if (cl) return cl.find(i => i.current)!.rect;
    return planeRect(d, currentVersion());
  });

  // workspace with nothing on it: freeze the camera so the empty-state stays put
  const locked = () => !reviewId() && store.state.loaded && store.deliverables().length === 0;
  // review mode pans only while comparing versions; workspace pans unless locked
  const panEnabled = () => (reviewId() ? compare() : !locked());

  const viewport = () => ({ w: container?.clientWidth ?? 800, h: container?.clientHeight ?? 600 });

  // ---- camera transitions --------------------------------------------------

  let savedWorkspaceCam: { x: number; y: number; zoom: number } | null = null;
  let firstFrame = true;

  function fitWorkspace(animate: boolean) {
    const rects = store.deliverables().map(cardRect);
    const target = camera.fitRect(boundsOf(rects), viewport().w, viewport().h, 80);
    // never zoom cards past 1:1 when fitting
    if (target.zoom > 1) {
      const b = boundsOf(rects);
      target.zoom = 1;
      target.x = b.x + b.w / 2 - viewport().w / 2;
      target.y = b.y + b.h / 2 - viewport().h / 2;
    }
    animate ? camera.flyTo(target) : camera.jumpTo(target);
  }

  function fitPlane(animate: boolean, duration = 400) {
    const cl = compareLayout();
    const p = cl ? boundsOf(cl.map(i => i.rect)) : plane();
    if (!p) return;
    const target = camera.fitRect(p, viewport().w, viewport().h, 64);
    animate ? camera.flyTo(target, duration) : camera.jumpTo(target);
  }

  function zoomAtCenter(factor: number) {
    if (locked()) return;
    camera.zoomAt(viewport().w / 2, viewport().h / 2, factor, 0.05, 64);
  }

  function fitCurrent() {
    current() ? fitPlane(true, 250) : fitWorkspace(true);
  }

  function toggleCompare() {
    const d = current();
    if (!d || d.versions.length < 2) return;
    setCompare(c => !c);
    // event handlers batch signal writes; fit only after the layout memo
    // reflects the new compare state, or the camera frames the old rects
    queueMicrotask(() => fitPlane(true, 300));
  }

  // depends ONLY on load state + which deliverable is under review; everything
  // else (camera math, selection resets) must stay untracked or a placed pin
  // would immediately re-trigger this and get pruned again
  createEffect(
    on([() => store.state.loaded && !!store.state.graph, reviewId], ([ready, id]) => {
      if (!ready) return;
      untrack(() => {
        if (id) {
          fitPlane(!firstFrame);
        } else {
          if (firstFrame) fitWorkspace(false);
          else if (savedWorkspaceCam) camera.flyTo(savedWorkspaceCam);
          else fitWorkspace(true);
        }
        firstFrame = false;
        // reset per-deliverable UI state when the subject changes
        setVersionOverride(null);
        setCompare(false);
        selectAnnotation(null);
        setPendingDecision(null);
      });
    })
  );

  // ---- selection / pruning -------------------------------------------------

  /** Deselecting an empty, open thread deletes it (a pin with no words is noise). */
  function selectAnnotation(id: string | null) {
    const prevId = selectedAnnId();
    if (prevId && prevId !== id) {
      const d = current();
      const prev = d?.annotations.find(a => a.id === prevId);
      if (d && prev && prev.status === "open" && prev.comments.length === 0) {
        store.removeAnnotation(d.id, prevId);
      }
    }
    setSelectedAnnId(id);
    if (id) setSidebarOpen(true);
  }

  function selectVersion(v: Version) {
    if (v.id === currentVersion()?.id) return;
    batch(() => {
      selectAnnotation(null);
      setVersionOverride(v.id);
    });
    queueMicrotask(() => fitPlane(true, 250));
  }

  // ---- navigation ----------------------------------------------------------

  function enterReview(d: Deliverable) {
    savedWorkspaceCam = { ...camera.cam };
    navigate(`/p/${store.projectId}/d/${d.id}`);
  }

  function exitReview() {
    selectAnnotation(null);
    navigate(`/p/${store.projectId}`);
  }

  function cycleReview(delta: number) {
    const list = store.deliverables();
    const d = current();
    if (!d || list.length < 2) return;
    const idx = list.findIndex(x => x.id === d.id);
    const next = list[(idx + delta + list.length) % list.length];
    navigate(`/p/${store.projectId}/d/${next.id}`);
  }

  // ---- uploads -------------------------------------------------------------

  async function uploadTo(d: Deliverable, files: File[]) {
    if (!canUpload()) return;
    for (const file of files) {
      flash(`Uploading ${file.name}…`);
      try {
        const v = await uploadVersion(d.id, file);
        store.addVersion(v);
        if (reviewId() === d.id) {
          setVersionOverride(v.id);
          fitPlane(true, 250);
        }
        flash(`${d.name} → v${v.number}`);
      } catch (e) {
        flash(e instanceof Error ? e.message : "Upload failed");
      }
    }
  }

  function createDeliverableAt(wx: number, wy: number, name?: string): Deliverable {
    const n = name ?? `Deliverable ${store.deliverables().length + 1}`;
    return store.addDeliverable(n, wx - CARD_W / 2, wy - 60);
  }

  function newDeliverableAtCenter() {
    if (!canCreate()) return;
    const c = camera.screenToWorld(viewport().w / 2, viewport().h / 2);
    const d = createDeliverableAt(c.x, c.y);
    flash(`Added ${d.name} — drop an image on it`);
  }

  let pickerTarget: Deliverable | null = null;
  function openFilePicker(d: Deliverable) {
    if (!canUpload()) return;
    pickerTarget = d;
    fileInput.click();
  }

  // ---- pointer input -------------------------------------------------------

  const localPoint = (e: { clientX: number; clientY: number }) => {
    const r = container.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0 && e.button !== 1) return;
    if (e.button === 1) e.preventDefault(); // no autoscroll
    const start = localPoint(e);
    let last = start;
    let dragged = false;

    container.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      const p = localPoint(ev);
      if (!dragged && Math.hypot(p.x - start.x, p.y - start.y) < 4) return;
      dragged = true; // still counts as a drag (won't place a pin on release)
      if (!panEnabled()) return;
      setPanning(true);
      camera.panBy(p.x - last.x, p.y - last.y);
      last = p;
    };
    const onUp = (ev: PointerEvent) => {
      container.removeEventListener("pointermove", onMove);
      container.removeEventListener("pointerup", onUp);
      container.releasePointerCapture(ev.pointerId);
      setPanning(false);
      if (dragged || ev.button !== 0) return;

      // a clean left click
      const d = current();
      const v = currentVersion();
      const p = plane();
      if (d && v && p) {
        const w = camera.screenToWorld(start.x, start.y);
        const nx = (w.x - p.x) / p.w;
        const ny = (w.y - p.y) / p.h;
        if (nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1) {
          // the core interaction: a click on the asset IS an annotation
          const a = store.addAnnotation(d.id, v.id, nx, ny);
          selectAnnotation(a.id);
          return;
        }
      }
      selectAnnotation(null);
    };
    container.addEventListener("pointermove", onMove);
    container.addEventListener("pointerup", onUp);
  }

  function onDblClick(e: MouseEvent) {
    if (reviewId() || !canCreate()) return;
    if ((e.target as HTMLElement).closest("[data-card]")) return;
    const p = localPoint(e);
    const w = camera.screenToWorld(p.x, p.y);
    createDeliverableAt(w.x, w.y);
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    if (locked()) return;
    const p = localPoint(e);
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    camera.zoomAt(p.x, p.y, factor, 0.05, 64);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    if (!canUpload()) return;
    const files = Array.from(e.dataTransfer?.files ?? []).filter(f =>
      f.type.startsWith("image/")
    );
    if (files.length === 0) return;

    const d = current();
    if (d) {
      void uploadTo(d, files);
      return;
    }

    const p = localPoint(e);
    const w = camera.screenToWorld(p.x, p.y);
    const hit = store.deliverables().find(dl => {
      const r = cardRect(dl);
      return w.x >= r.x && w.x <= r.x + r.w && w.y >= r.y && w.y <= r.y + r.h;
    });
    if (hit) {
      void uploadTo(hit, files);
    } else if (canCreate()) {
      files.forEach((file, i) => {
        const name = file.name.replace(/\.[^.]+$/, "");
        const nd = createDeliverableAt(w.x + i * (CARD_W + 24), w.y, name);
        void uploadTo(nd, [file]);
      });
    }
  }

  // ---- decisions -----------------------------------------------------------

  // ---- deletion (soft; restorable from History) ----------------------------

  function confirmDeleteVersion(v?: Version) {
    const d = current();
    const target = v ?? currentVersion();
    if (!d || !target || !canDeleteVersion()) return;
    if (!window.confirm(`Delete v${target.number} of ${d.name}? You can restore it from History.`)) return;
    batch(() => {
      selectAnnotation(null);
      if (currentVersion()?.id === target.id || versionOverride() === target.id) {
        setVersionOverride(null);
      }
    });
    store.removeVersion(d.id, target.id);
    if (d.versions.length < 2) setCompare(false);
    queueMicrotask(() => fitPlane(true, 250));
    flash(`v${target.number} deleted — restore from History (H)`);
  }

  function confirmDeleteDeliverable(d: Deliverable) {
    if (!canDeleteDeliverable()) return;
    if (!window.confirm(`Delete ${d.name}? You can restore it from History.`)) return;
    if (reviewId() === d.id) exitReview();
    store.removeDeliverable(d.id);
    flash(`${d.name} deleted — restore from History (H)`);
  }

  // ---- context menus (one shared component, same entries everywhere) -------
  // Every context menu is mirrored by a visible ⋯ kebab on its surface, so
  // nothing is discoverable only by right-clicking.

  function workspaceMenuEntries(at?: { x: number; y: number }): MenuEntry[] {
    return [
      ...(canCreate()
        ? [
            {
              label: at ? "New deliverable here" : "New deliverable",
              icon: "iconoir:plus",
              hint: "N",
              run: () => (at ? createDeliverableAt(at.x, at.y) : newDeliverableAtCenter()),
            },
          ]
        : []),
      { label: "Project history", icon: "iconoir:clock", hint: "H", run: () => setHistoryOpen(o => !o) },
      ...(!locked()
        ? [{ label: "Fit to screen", icon: "iconoir:frame", hint: "F", run: () => fitWorkspace(true) }]
        : []),
    ];
  }

  function reviewMenuEntries(d: Deliverable): MenuEntry[] {
    const v = currentVersion();
    return [
      ...(canUpload()
        ? [{ label: "Upload new version", icon: "iconoir:upload", hint: "U", run: () => openFilePicker(d) }]
        : []),
      ...(d.versions.length > 1
        ? [
            {
              label: compare() ? "Exit compare" : "Compare versions",
              icon: "iconoir:media-image-list",
              hint: "C",
              run: toggleCompare,
            },
          ]
        : []),
      { label: "Project history", icon: "iconoir:clock", hint: "H", run: () => setHistoryOpen(o => !o) },
      { label: "Fit to screen", icon: "iconoir:frame", hint: "F", run: () => fitPlane(true, 250) },
      ...(canDeleteVersion() && v
        ? [
            { separator: true } as const,
            { label: `Delete v${v.number}`, icon: "iconoir:trash", danger: true, run: () => confirmDeleteVersion(v) },
          ]
        : []),
      ...(canDeleteDeliverable()
        ? [
            {
              label: "Delete deliverable",
              icon: "iconoir:trash",
              danger: true,
              run: () => confirmDeleteDeliverable(d),
            },
          ]
        : []),
    ];
  }

  /** open a surface's menu anchored under its kebab button */
  function openMenuAt(e: MouseEvent, entries: MenuEntry[]) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setCtxMenu({ x: r.left, y: r.bottom + 4, entries });
  }

  function deliverableMenuEntries(d: Deliverable): MenuEntry[] {
    return [
      { label: "Open review", icon: "iconoir:open-in-window", hint: "↵", run: () => enterReview(d) },
      ...(canEdit()
        ? [{ label: "Rename", icon: "iconoir:edit-pencil", run: () => cardActions.get(d.id)?.startRename() }]
        : []),
      ...(canUpload()
        ? [{ label: "Upload version", icon: "iconoir:upload", run: () => openFilePicker(d) }]
        : []),
      ...(canDeleteDeliverable()
        ? [
            { separator: true } as const,
            {
              label: "Delete deliverable",
              icon: "iconoir:trash",
              hint: "⌫",
              danger: true,
              run: () => confirmDeleteDeliverable(d),
            },
          ]
        : []),
    ];
  }

  function onCanvasContextMenu(e: MouseEvent) {
    e.preventDefault();
    const d = current();
    if (d) {
      setCtxMenu({ x: e.clientX, y: e.clientY, entries: reviewMenuEntries(d) });
    } else {
      const p = localPoint(e);
      const w = camera.screenToWorld(p.x, p.y);
      setCtxMenu({ x: e.clientX, y: e.clientY, entries: workspaceMenuEntries(w) });
    }
  }

  function onVersionTabContextMenu(e: MouseEvent, d: Deliverable, v: Version) {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({
      x: e.clientX,
      y: e.clientY,
      entries: [
        { label: `Show v${v.number}`, icon: "iconoir:eye-solid", hint: String(v.number), run: () => selectVersion(v) },
        ...(d.versions.length > 1
          ? [
              {
                label: "Compare versions",
                icon: "iconoir:media-image-list",
                hint: "C",
                run: () => {
                  if (!compare()) toggleCompare();
                },
              },
            ]
          : []),
        ...(canDeleteVersion()
          ? [
              { separator: true } as const,
              {
                label: `Delete v${v.number}`,
                icon: "iconoir:trash",
                danger: true,
                run: () => confirmDeleteVersion(v),
              },
            ]
          : []),
      ],
    });
  }

  async function confirmDecision(note: string) {
    const d = current();
    const v = currentVersion();
    const decision = pendingDecision();
    if (!d || !v || !decision) return;
    setPendingDecision(null);
    const res = await store.decide(d.id, v.id, decision, note);
    if (!res.ok) flash(res.error ?? "Decision rejected");
    else flash(decision === "approved" ? `${d.name} v${v.number} approved` : `Revisions requested on ${d.name}`);
  }

  // ---- keyboard ------------------------------------------------------------

  function isTyping(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    return t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable;
  }

  function onKeyDown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      setPaletteOpen(o => !o);
      return;
    }
    if (paletteOpen() || isTyping(e)) return;

    if (e.key === "h" || e.key === "H") {
      setHistoryOpen(o => !o);
      return;
    }

    const d = current();
    if (d) {
      // review mode
      switch (e.key) {
        case "Escape":
          if (historyOpen()) setHistoryOpen(false);
          else if (pendingDecision()) setPendingDecision(null);
          else if (selectedAnnId()) selectAnnotation(null);
          else exitReview();
          return;
        case "u":
        case "U":
          if (canUpload()) openFilePicker(d);
          return;
        case "Tab":
          e.preventDefault();
          setSidebarOpen(o => !o);
          return;
        case "ArrowLeft":
          cycleReview(-1);
          return;
        case "ArrowRight":
          cycleReview(1);
          return;
        case "f":
        case "F":
          fitPlane(true, 250);
          return;
        case "c":
        case "C":
          toggleCompare();
          return;
      }
      const n = Number(e.key);
      if (n >= 1 && n <= 9) {
        const v = d.versions.find(v => v.number === n);
        if (v) selectVersion(v);
      }
    } else {
      // workspace mode
      switch (e.key) {
        case "Escape":
          if (historyOpen()) setHistoryOpen(false);
          return;
        case "n":
        case "N":
          if (canCreate()) newDeliverableAtCenter();
          return;
        case "f":
        case "F":
          if (!locked()) fitWorkspace(true);
          return;
      }
    }
  }

  onMount(() => {
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  // ---- render --------------------------------------------------------------

  const counts = createMemo(() => {
    const list = store.deliverables();
    return {
      total: list.length,
      inReview: list.filter(d => d.status === "in_review").length,
      approved: list.filter(d => d.status === "approved").length,
    };
  });

  return (
    <div class="p-1 h-screen bg-[#fffefe]">
      <div class="rounded-lg overflow-clip w-full flex flex-col h-full border border-[#eceaea]">
        {/* ---- nav ---- */}
        <nav class="min-h-12 px-3 flex items-center justify-between gap-4 bg-[#f8f7f7] border-b border-[#f0eeee] z-10">
          <div class="flex items-center gap-2 text-sm min-w-0">
            <button
              class="flex items-center text-neutral-500 hover:text-neutral-800 cursor-pointer p-1"
              title={reviewId() ? "Back to workspace (Esc)" : "All projects"}
              onClick={() => (reviewId() ? exitReview() : navigate("/"))}
            >
              <Icon icon="iconoir:arrow-left" width="16" />
            </button>
            <span class="font-medium text-neutral-800 truncate">
              {store.state.graph?.project.name ?? "…"}
            </span>
            <Show when={store.state.graph?.project.clientName}>
              <span class="bg-[#efeded] text-neutral-500 text-xs py-0.5 px-1.5 rounded">
                {store.state.graph!.project.clientName}
              </span>
            </Show>
            <Show when={current()}>
              {d => (
                <>
                  <span class="text-neutral-300">/</span>
                  <span class="text-neutral-700 truncate">{d().name}</span>
                  <span
                    class={`text-[10px] rounded-full px-1.5 py-px ${STATUS_META[d().status].chip}`}
                  >
                    {STATUS_META[d().status].label}
                  </span>
                </>
              )}
            </Show>
          </div>

          <div class="hidden md:block">
            <Show when={store.state.graph}>
              <StatusRail phase={store.state.graph!.project.phase} />
            </Show>
          </div>

          <div class="flex items-center gap-2 relative">
            <button
              class="flex items-center p-1.5 rounded cursor-pointer"
              classList={{
                "bg-neutral-200/70 text-neutral-800": historyOpen(),
                "text-neutral-500 hover:text-neutral-800": !historyOpen(),
              }}
              title="Project history (H)"
              onClick={() => setHistoryOpen(o => !o)}
            >
              <Icon icon="iconoir:clock" width="15" />
            </button>
            <Show
              when={current()}
              fallback={
                <Show when={canCreate()}>
                  <button
                    class="flex items-center gap-1 text-xs bg-neutral-900 text-white rounded px-2.5 py-1.5 hover:bg-neutral-700 cursor-pointer"
                    onClick={newDeliverableAtCenter}
                    title="New deliverable (N)"
                  >
                    <Icon icon="iconoir:plus" width="14" /> Deliverable
                  </button>
                </Show>
              }
            >
              {d => (
                <>
                  {/* version tabs */}
                  <div class="flex items-center gap-0.5 bg-[#efeded] rounded p-0.5">
                    <For each={d().versions}>
                      {v => (
                        <button
                          class="text-[11px] px-1.5 py-0.5 rounded cursor-pointer"
                          classList={{
                            "bg-white shadow-sm text-neutral-800": currentVersion()?.id === v.id,
                            "text-neutral-500 hover:text-neutral-800": currentVersion()?.id !== v.id,
                          }}
                          title={`Version ${v.number} (${v.number}) — right-click for actions`}
                          onClick={() => selectVersion(v)}
                          onContextMenu={e => onVersionTabContextMenu(e, d(), v)}
                        >
                          v{v.number}
                        </button>
                      )}
                    </For>
                    <Show when={canUpload()}>
                      <button
                        class="text-[11px] px-1 py-0.5 rounded text-neutral-500 hover:text-neutral-800 cursor-pointer"
                        title="Upload new version (U)"
                        onClick={() => openFilePicker(d())}
                      >
                        <Icon icon="iconoir:plus" width="12" />
                      </button>
                    </Show>
                  </div>

                  <Show when={d().versions.length > 1}>
                    <button
                      class="flex items-center gap-1 text-xs rounded border px-2.5 py-1.5 cursor-pointer"
                      classList={{
                        "bg-sky-50 border-sky-200 text-sky-700": compare(),
                        "border-neutral-200 text-neutral-600 hover:bg-neutral-50": !compare(),
                      }}
                      title="Compare versions side by side (C)"
                      onClick={toggleCompare}
                    >
                      <Icon icon="iconoir:media-image-list" width="13" /> Compare
                    </button>
                  </Show>

                  <button
                    class="flex items-center gap-1 text-xs border border-amber-200 bg-amber-50 text-amber-700 rounded px-2.5 py-1.5 hover:bg-amber-100 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    disabled={!currentVersion()}
                    onClick={() => setPendingDecision("revision_requested")}
                  >
                    <Icon icon="iconoir:refresh" width="13" /> Request revisions
                  </button>
                  <button
                    class="flex items-center gap-1 text-xs bg-emerald-600 text-white rounded px-2.5 py-1.5 hover:bg-emerald-500 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    disabled={!currentVersion() || openThreadCount() > 0}
                    title={
                      openThreadCount() > 0
                        ? `${openThreadCount()} open thread(s) must be resolved first`
                        : "Approve this version"
                    }
                    onClick={() => setPendingDecision("approved")}
                  >
                    <Icon icon="iconoir:check" width="13" /> Approve
                  </button>

                  {/* decision popover */}
                  <Show when={pendingDecision()}>
                    <div class="absolute top-full right-0 mt-2 w-72 bg-white border border-neutral-200 rounded-lg shadow-xl p-3 z-30">
                      <p class="text-xs font-semibold text-neutral-800 mb-2">
                        {pendingDecision() === "approved" ? "Approve" : "Request revisions on"}{" "}
                        {d().name} v{currentVersion()?.number}
                      </p>
                      <textarea
                        id="decision-note"
                        rows="2"
                        class="w-full text-xs border border-neutral-200 rounded px-2 py-1.5 mb-2 outline-none focus:border-sky-400 resize-none"
                        placeholder="Note (optional)"
                        ref={el => queueMicrotask(() => el.focus())}
                        onKeyDown={e => {
                          e.stopPropagation();
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            void confirmDecision((e.currentTarget as HTMLTextAreaElement).value.trim());
                          }
                          if (e.key === "Escape") setPendingDecision(null);
                        }}
                      />
                      <div class="flex gap-2 justify-end">
                        <button
                          class="text-xs text-neutral-500 hover:text-neutral-700 px-2 py-1 cursor-pointer"
                          onClick={() => setPendingDecision(null)}
                        >
                          Cancel
                        </button>
                        <button
                          class="text-xs text-white rounded px-2.5 py-1 cursor-pointer disabled:opacity-40"
                          classList={{
                            "bg-emerald-600 hover:bg-emerald-500": pendingDecision() === "approved",
                            "bg-amber-600 hover:bg-amber-500": pendingDecision() === "revision_requested",
                          }}
                          onClick={() =>
                            void confirmDecision(
                              (document.getElementById("decision-note") as HTMLTextAreaElement)?.value.trim() ?? ""
                            )
                          }
                        >
                          Confirm
                        </button>
                      </div>
                    </div>
                  </Show>
                </>
              )}
            </Show>

            {/* the mode's context-menu actions, discoverable without right-click */}
            <button
              class="flex items-center p-1.5 rounded cursor-pointer text-neutral-500 hover:text-neutral-800 hover:bg-neutral-200/50"
              title="More actions"
              onClick={e => {
                const d = current();
                openMenuAt(e, d ? reviewMenuEntries(d) : workspaceMenuEntries());
              }}
            >
              <Icon icon="iconoir:more-horiz" width="15" />
            </button>
          </div>
        </nav>

        {/* ---- main ---- */}
        <div class="flex-1 flex min-h-0">
          <div
            ref={container}
            class="relative flex-1 overflow-hidden bg-[#fffefe] select-none"
            classList={{
              "cursor-grabbing": panning(),
              "cursor-grab": !panning() && panEnabled(),
              "cursor-default": !panning() && !panEnabled(),
            }}
            onPointerDown={onPointerDown}
            onDblClick={onDblClick}
            onWheel={onWheel}
            onContextMenu={onCanvasContextMenu}
            onDragOver={e => e.preventDefault()}
            onDrop={onDrop}
          >
            <DotGrid camera={camera} />

            {/* world overlay */}
            <div
              class="absolute top-0 left-0"
              style={{
                transform: `scale(${camera.cam.zoom}) translate(${-camera.cam.x}px, ${-camera.cam.y}px)`,
                "transform-origin": "0 0",
              }}
            >
              <Show
                when={current()}
                fallback={
                  <For each={store.deliverables()}>
                    {d => (
                      <DeliverableCard
                        d={d}
                        readOnly={!canEdit()}
                        onOpen={enterReview}
                        onMove={(dl, x, y, done) => store.moveDeliverable(dl.id, x, y, done)}
                        onRename={(dl, name) => store.renameDeliverable(dl.id, name)}
                        onDelete={canDeleteDeliverable() ? confirmDeleteDeliverable : undefined}
                        onMenu={(dl, x, y) => setCtxMenu({ x, y, entries: deliverableMenuEntries(dl) })}
                        registerActions={(id, actions) => cardActions.set(id, actions)}
                        screenToWorldDelta={(dx, dy) => ({
                          x: dx / camera.cam.zoom,
                          y: dy / camera.cam.zoom,
                        })}
                      />
                    )}
                  </For>
                }
              >
                {d => (
                  <>
                    {/* comparison row: every version, current highlighted */}
                    <Show when={compareLayout()}>
                      {cl => (
                        <For each={cl()}>
                          {item => (
                            <>
                              <div
                                class="absolute pointer-events-none"
                                style={{ left: `${item.rect.x}px`, top: `${item.rect.y}px` }}
                              >
                                <span
                                  class="inline-block text-[12px] font-semibold rounded px-1.5 py-0.5 whitespace-nowrap"
                                  classList={{
                                    "bg-sky-500 text-white": item.current,
                                    "bg-neutral-200 text-neutral-600": !item.current,
                                  }}
                                  style={{
                                    transform: `scale(${1 / camera.cam.zoom}) translateY(-135%)`,
                                    "transform-origin": "0 0",
                                  }}
                                >
                                  v{item.v.number}
                                  {item.current ? " · current" : ""}
                                </span>
                              </div>
                              <Show when={!item.current}>
                                <img
                                  src={fileUrl(item.v.fileName)}
                                  alt={`Version ${item.v.number}`}
                                  class="absolute max-w-none bg-white shadow-[0_4px_24px_rgba(0,0,0,0.10)] cursor-pointer"
                                  draggable={false}
                                  style={{
                                    left: `${item.rect.x}px`,
                                    top: `${item.rect.y}px`,
                                    width: `${item.rect.w}px`,
                                    height: `${item.rect.h}px`,
                                  }}
                                  title={`Switch to v${item.v.number}`}
                                  onClick={e => {
                                    e.stopPropagation();
                                    selectVersion(item.v);
                                  }}
                                />
                              </Show>
                            </>
                          )}
                        </For>
                      )}
                    </Show>
                    <ReviewPlane
                      d={d()}
                      version={currentVersion()}
                      rect={plane()!}
                      zoom={camera.cam.zoom}
                      annotations={versionAnnotations()}
                      selectedId={selectedAnnId()}
                      onSelectPin={id => selectAnnotation(id)}
                      canUpload={canUpload()}
                      highlight={compare()}
                    />
                  </>
                )}
              </Show>
            </div>

            {/* empty state */}
            <Show when={store.state.loaded && !reviewId() && store.deliverables().length === 0}>
              <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div class="text-center text-neutral-400">
                  <Icon icon="iconoir:media-image-list" width="40" />
                  <p class="mt-3 text-sm font-medium text-neutral-500">No deliverables yet</p>
                  <p class="mt-1 text-xs">
                    <Show
                      when={canCreate()}
                      fallback={<>Nothing has been shared for review yet</>}
                    >
                      Press <kbd class="px-1 bg-neutral-100 rounded border border-neutral-200">N</kbd>,
                      double-click the canvas, or drop images anywhere
                    </Show>
                  </p>
                </div>
              </div>
            </Show>

            <Show when={store.state.error}>
              <div class="absolute inset-0 flex items-center justify-center">
                <p class="text-sm text-neutral-500">{store.state.error}</p>
              </div>
            </Show>

            {/* navigation controls — the visible face of scroll-zoom and F */}
            <Show when={!locked()}>
              <div
                class="absolute bottom-3 right-3 z-10 flex flex-col rounded-lg border border-neutral-200 bg-white/95 shadow-sm overflow-clip"
                onPointerDown={e => e.stopPropagation()}
                onDblClick={e => e.stopPropagation()}
                onWheel={e => e.stopPropagation()}
                onContextMenu={e => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
              >
                <button
                  class="p-1.5 text-neutral-500 hover:text-neutral-800 hover:bg-neutral-50 cursor-pointer"
                  title="Zoom in"
                  onClick={() => zoomAtCenter(1.25)}
                >
                  <Icon icon="iconoir:plus" width="14" />
                </button>
                <button
                  class="p-1.5 text-neutral-500 hover:text-neutral-800 hover:bg-neutral-50 cursor-pointer border-t border-neutral-100"
                  title="Zoom out"
                  onClick={() => zoomAtCenter(0.8)}
                >
                  <Icon icon="iconoir:minus" width="14" />
                </button>
                <button
                  class="p-1.5 text-neutral-500 hover:text-neutral-800 hover:bg-neutral-50 cursor-pointer border-t border-neutral-100"
                  title="Fit to screen (F)"
                  onClick={fitCurrent}
                >
                  <Icon icon="iconoir:frame" width="14" />
                </button>
              </div>
            </Show>
          </div>

          <Show
            when={historyOpen()}
            fallback={
              <Show when={current() && sidebarOpen()}>
                <ThreadSidebar
                  annotations={versionAnnotations()}
                  selectedId={selectedAnnId()}
                  onSelect={selectAnnotation}
                  onComment={(annId, body) => store.addComment(current()!.id, annId, body)}
                  onResolve={(annId, status) => store.resolveAnnotation(current()!.id, annId, status)}
                />
              </Show>
            }
          >
            <HistoryPanel
              projectId={store.projectId}
              canRestore={canDeleteVersion() || canDeleteDeliverable()}
              onClose={() => setHistoryOpen(false)}
              onRestored={() => void store.reload()}
            />
          </Show>
        </div>

        {/* ---- status bar ---- */}
        <footer class="min-h-7 px-3 flex items-center justify-between bg-[#f8f7f7] border-t border-[#f0eeee] text-[11px] text-neutral-400">
          <div class="flex items-center gap-3">
            <Show
              when={current()}
              fallback={
                <span>
                  {counts().total} deliverable{counts().total === 1 ? "" : "s"} ·{" "}
                  {counts().inReview} in review · {counts().approved} approved
                </span>
              }
            >
              {d => (
                <span>
                  {d().name}
                  <Show when={currentVersion()}>
                    {v => (
                      <>
                        {" "}· v{v().number} · {v().width}×{v().height}
                      </>
                    )}
                  </Show>
                  {" "}· {openThreadCount()} open thread{openThreadCount() === 1 ? "" : "s"}
                </span>
              )}
            </Show>
            <Show when={statusMsg()}>
              <span class="text-neutral-600 font-medium">{statusMsg()}</span>
            </Show>
          </div>
          <span class="hidden sm:block">
            {current()
              ? [
                  "click image to pin",
                  "right-click for actions",
                  canUpload() && "U upload",
                  "1–9 versions",
                  current()!.versions.length > 1 && (compare() ? "C exit compare" : "C compare"),
                  "← → next",
                  "F fit",
                  "H history",
                  "Esc back",
                  "⌘K",
                ]
                  .filter(Boolean)
                  .join(" · ")
              : locked()
                ? canCreate()
                  ? "N new · double-click to add · drop images anywhere · ⌘K"
                  : "Nothing shared for review yet"
                : canCreate()
                  ? "N new · double-click to add · drop images · right-click for actions · F fit · H history · ⌘K"
                  : "click a card to review · right-click for actions · F fit · H history · ⌘K"}
          </span>
        </footer>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        class="hidden"
        onChange={e => {
          const files = Array.from(e.currentTarget.files ?? []);
          e.currentTarget.value = "";
          if (pickerTarget && files.length) void uploadTo(pickerTarget, files);
          pickerTarget = null;
        }}
      />

      <ContextMenu state={ctxMenu()} onClose={() => setCtxMenu(null)} />

      <CommandPalette
        open={paletteOpen()}
        onClose={() => setPaletteOpen(false)}
        store={store}
        currentDeliverable={current()}
        actions={{
          newDeliverable: newDeliverableAtCenter,
          openDeliverable: d => (reviewId() ? navigate(`/p/${store.projectId}/d/${d.id}`) : enterReview(d)),
          upload: () => {
            const d = current();
            if (d) openFilePicker(d);
          },
          approve: () => current() && setPendingDecision("approved"),
          requestRevisions: () => current() && setPendingDecision("revision_requested"),
          exitReview,
          fit: () => (current() ? fitPlane(true, 250) : fitWorkspace(true)),
          compare: toggleCompare,
          history: () => setHistoryOpen(o => !o),
          deleteVersion: confirmDeleteVersion,
          deleteDeliverable: () => {
            const d = current();
            if (d) confirmDeleteDeliverable(d);
          },
        }}
      />
    </div>
  );
}
