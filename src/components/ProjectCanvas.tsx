import { For, Show, batch, createEffect, createMemo, createSignal, on, onCleanup, onMount, untrack } from "solid-js";
import { useNavigate, useParams, A } from "@solidjs/router";
import { Icon } from "@iconify-icon/solid";
import { createCamera } from "../lib/canvas/camera";
import { DotGrid } from "../lib/canvas/DotGrid";
import { CARD_W, boundsOf, cardRect, planeRect } from "../lib/canvas/geometry";
import { useProject, uploadVersion } from "../lib/store";
import { author, setAuthor } from "../lib/author";
import type { Annotation, Decision, Deliverable, Version } from "../lib/types";
import { DeliverableCard, STATUS_META } from "./DeliverableCard";
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
  const [sidebarOpen, setSidebarOpen] = createSignal(true);
  const [paletteOpen, setPaletteOpen] = createSignal(false);
  const [panning, setPanning] = createSignal(false);
  const [statusMsg, setStatusMsg] = createSignal("");
  const [pendingDecision, setPendingDecision] = createSignal<Decision | null>(null);

  let statusTimer: ReturnType<typeof setTimeout> | undefined;
  function flash(msg: string) {
    setStatusMsg(msg);
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => setStatusMsg(""), 4000);
  }

  // ---- derived state -------------------------------------------------------

  const reviewId = () => params.deliverableId as string | undefined;
  const current = createMemo(() => (reviewId() ? store.byId(reviewId()!) : undefined));

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

  const plane = createMemo(() => {
    const d = current();
    return d ? planeRect(d, currentVersion()) : null;
  });

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
    const p = plane();
    if (!p) return;
    const target = camera.fitRect(p, viewport().w, viewport().h, 64);
    animate ? camera.flyTo(target, duration) : camera.jumpTo(target);
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
    fitPlane(true, 250);
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
    const c = camera.screenToWorld(viewport().w / 2, viewport().h / 2);
    const d = createDeliverableAt(c.x, c.y);
    flash(`Added ${d.name} — drop an image on it`);
  }

  let pickerTarget: Deliverable | null = null;
  function openFilePicker(d: Deliverable) {
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
      dragged = true;
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
    if (reviewId()) return;
    if ((e.target as HTMLElement).closest("[data-card]")) return;
    const p = localPoint(e);
    const w = camera.screenToWorld(p.x, p.y);
    createDeliverableAt(w.x, w.y);
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const p = localPoint(e);
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    camera.zoomAt(p.x, p.y, factor, 0.05, 64);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
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
    } else {
      files.forEach((file, i) => {
        const name = file.name.replace(/\.[^.]+$/, "");
        const nd = createDeliverableAt(w.x + i * (CARD_W + 24), w.y, name);
        void uploadTo(nd, [file]);
      });
    }
  }

  // ---- decisions -----------------------------------------------------------

  async function confirmDecision(note: string) {
    const d = current();
    const v = currentVersion();
    const decision = pendingDecision();
    if (!d || !v || !decision || !author()) return;
    setPendingDecision(null);
    const res = await store.decide(d.id, v.id, decision, author(), note);
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

    const d = current();
    if (d) {
      // review mode
      switch (e.key) {
        case "Escape":
          if (pendingDecision()) setPendingDecision(null);
          else if (selectedAnnId()) selectAnnotation(null);
          else exitReview();
          return;
        case "u":
        case "U":
          openFilePicker(d);
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
      }
      const n = Number(e.key);
      if (n >= 1 && n <= 9) {
        const v = d.versions.find(v => v.number === n);
        if (v) selectVersion(v);
      }
    } else {
      // workspace mode
      switch (e.key) {
        case "n":
        case "N":
          newDeliverableAtCenter();
          return;
        case "f":
        case "F":
          fitWorkspace(true);
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
            <Show
              when={current()}
              fallback={
                <button
                  class="flex items-center gap-1 text-xs bg-neutral-900 text-white rounded px-2.5 py-1.5 hover:bg-neutral-700 cursor-pointer"
                  onClick={newDeliverableAtCenter}
                  title="New deliverable (N)"
                >
                  <Icon icon="iconoir:plus" width="14" /> Deliverable
                </button>
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
                          title={`Version ${v.number} (${v.number})`}
                          onClick={() => selectVersion(v)}
                        >
                          v{v.number}
                        </button>
                      )}
                    </For>
                    <button
                      class="text-[11px] px-1 py-0.5 rounded text-neutral-500 hover:text-neutral-800 cursor-pointer"
                      title="Upload new version (U)"
                      onClick={() => openFilePicker(d())}
                    >
                      <Icon icon="iconoir:plus" width="12" />
                    </button>
                  </div>

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
                      <Show when={!author()}>
                        <label class="text-[10px] text-neutral-500 block mb-1">Your name</label>
                        <input
                          class="w-full text-xs border border-neutral-200 rounded px-2 py-1.5 mb-2 outline-none focus:border-sky-400"
                          placeholder="e.g. Mike"
                          ref={el => queueMicrotask(() => el.focus())}
                          onKeyDown={e => e.stopPropagation()}
                          onChange={e => setAuthor(e.currentTarget.value.trim())}
                        />
                      </Show>
                      <textarea
                        id="decision-note"
                        rows="2"
                        class="w-full text-xs border border-neutral-200 rounded px-2 py-1.5 mb-2 outline-none focus:border-sky-400 resize-none"
                        placeholder="Note (optional)"
                        ref={el => {
                          if (author()) queueMicrotask(() => el.focus());
                        }}
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
                          disabled={!author()}
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
          </div>
        </nav>

        {/* ---- main ---- */}
        <div class="flex-1 flex min-h-0">
          <div
            ref={container}
            class="relative flex-1 overflow-hidden bg-[#fffefe]"
            classList={{ "cursor-grabbing": panning(), "cursor-grab": !panning() }}
            onPointerDown={onPointerDown}
            onDblClick={onDblClick}
            onWheel={onWheel}
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
                        onOpen={enterReview}
                        onMove={(dl, x, y, done) => store.moveDeliverable(dl.id, x, y, done)}
                        onRename={(dl, name) => store.renameDeliverable(dl.id, name)}
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
                  <ReviewPlane
                    d={d()}
                    version={currentVersion()}
                    rect={plane()!}
                    zoom={camera.cam.zoom}
                    annotations={versionAnnotations()}
                    selectedId={selectedAnnId()}
                    onSelectPin={id => selectAnnotation(id)}
                  />
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
                    Press <kbd class="px-1 bg-neutral-100 rounded border border-neutral-200">N</kbd>,
                    double-click the canvas, or drop images anywhere
                  </p>
                </div>
              </div>
            </Show>

            <Show when={store.state.error}>
              <div class="absolute inset-0 flex items-center justify-center">
                <p class="text-sm text-neutral-500">{store.state.error}</p>
              </div>
            </Show>
          </div>

          <Show when={current() && sidebarOpen()}>
            <ThreadSidebar
              annotations={versionAnnotations()}
              selectedId={selectedAnnId()}
              onSelect={selectAnnotation}
              onComment={(annId, body) => store.addComment(current()!.id, annId, author(), body)}
              onResolve={(annId, status) => store.resolveAnnotation(current()!.id, annId, status)}
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
              ? "click image to pin · U upload · 1–9 versions · ← → next · F fit · Tab panel · Esc back · ⌘K"
              : "N new · double-click to add · drop images · drag cards · scroll to zoom · F fit · ⌘K"}
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
        }}
      />
    </div>
  );
}
